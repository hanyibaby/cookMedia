var EventProxy = require('eventproxy');
var models     = require('../models');
var News      = models.News;
var User       = require('./user');
var Reply      = require('./reply');
var tools      = require('../common/tools');
var at         = require('../common/at');
var _          = require('lodash');


/**
 * 根据主题ID获取主题
 * Callback:
 * - err, 数据库错误
 * - news, 主题
 * - author, 作者
 * - lastReply, 最后回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getNewsById = function (id, callback) {
    var proxy = new EventProxy();
    var events = ['news', 'author', 'last_reply'];
    proxy.assign(events, function (news, author, last_reply) {
        if (!author) {
            return callback(null, null, null, null);
        }
        return callback(null, news, author, last_reply);
    }).fail(callback);

    News.findOne({_id: id}, proxy.done(function (news) {
        if (!news) {
            proxy.emit('news', null);
            proxy.emit('author', null);
            proxy.emit('last_reply', null);
            return;
        }
        proxy.emit('news', news);

        User.getUserById(news.author_id, proxy.done('author'));

        if (news.last_reply) {
            Reply.getReplyById(news.last_reply, proxy.done(function (last_reply) {
                proxy.emit('last_reply', last_reply);
            }));
        } else {
            proxy.emit('last_reply', null);
        }
    }));
};

/**
 * 获取关键词能搜索到的主题数量
 * Callback:
 * - err, 数据库错误
 * - count, 主题数量
 * @param {String} query 搜索关键词
 * @param {Function} callback 回调函数
 */
exports.getCountByQuery = function (query, callback) {
    News.count(query, callback);
};

/**
 * 根据关键词，获取主题列表
 * Callback:
 * - err, 数据库错误
 * - count, 主题列表
 * @param {String} query 搜索关键词
 * @param {Object} opt 搜索选项
 * @param {Function} callback 回调函数
 */
exports.getNewssByQuery = function (query, opt, callback) {
    query.deleted = false;
    News.find(query, {}, opt, function (err, newss) {
        if (err) {
            return callback(err);
        }
        if (newss.length === 0) {
            return callback(null, []);
        }

        var proxy = new EventProxy();
        proxy.after('news_ready', newss.length, function () {
            newss = _.compact(newss); // 删除不合规的 news
            return callback(null, newss);
        });
        proxy.fail(callback);

        newss.forEach(function (news, i) {
            var ep = new EventProxy();
            ep.all('author', 'reply', function (author, reply) {
                // 保证顺序
                // 作者可能已被删除
                if (author) {
                    news.author = author;
                    news.reply = reply;
                } else {
                    newss[i] = null;
                }
                proxy.emit('news_ready');
            });

            User.getUserById(news.author_id, ep.done('author'));
            // 获取主题的最后回复
            Reply.getReplyById(news.last_reply, ep.done('reply'));
        });
    });
};

// for sitemap
exports.getLimit5w = function (callback) {
    News.find({deleted: false}, '_id', {limit: 50000, sort: '-create_at'}, callback);
};

/**
 * 获取所有信息的主题
 * Callback:
 * - err, 数据库异常
 * - message, 消息
 * - news, 主题
 * - author, 主题作者
 * - replies, 主题的回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getFullNews = function (id, callback) {
    var proxy = new EventProxy();
    var events = ['news', 'author', 'replies'];
    proxy
        .assign(events, function (news, author, replies) {
            callback(null, '', news, author, replies);
        })
        .fail(callback);

    News.findOne({_id: id, deleted: false}, proxy.done(function (news) {
        if (!news) {
            proxy.unbind();
            return callback(null, '此话题不存在或已被删除。');
        }
        at.linkUsers(news.content, proxy.done('news', function (str) {
            news.linkedContent = str;
            return news;
        }));

        User.getUserById(news.author_id, proxy.done(function (author) {
            if (!author) {
                proxy.unbind();
                return callback(null, '话题的作者丢了。');
            }
            proxy.emit('author', author);
        }));

        Reply.getRepliesByNewsId(news._id, proxy.done('replies'));
    }));
};

/**
 * 更新主题的最后回复信息
 * @param {String} newsId 主题ID
 * @param {String} replyId 回复ID
 * @param {Function} callback 回调函数
 */
exports.updateLastReply = function (newsId, replyId, callback) {
    News.findOne({_id: newsId}, function (err, news) {
        if (err || !news) {
            return callback(err);
        }
        news.last_reply    = replyId;
        news.last_reply_at = new Date();
        news.reply_count += 1;
        news.save(callback);
    });
};

/**
 * 根据主题ID，查找一条主题
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getNews = function (id, callback) {
    News.findOne({_id: id}, callback);
};

/**
 * 将当前主题的回复计数减1，并且更新最后回复的用户，删除回复时用到
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.reduceCount = function (id, callback) {
    News.findOne({_id: id}, function (err, news) {
        if (err) {
            return callback(err);
        }

        if (!news) {
            return callback(new Error('该主题不存在'));
        }
        news.reply_count -= 1;

        Reply.getLastReplyByTopId(id, function (err, reply) {
            if (err) {
                return callback(err);
            }

            if (reply.length !== 0) {
                news.last_reply = reply[0]._id;
            } else {
                news.last_reply = null;
            }

            news.save(callback);
        });

    });
};

exports.newAndSave = function (title, content, newsTab, authorId, callback) {
    var news       = new News();
    news.title     = title;
    news.content   = content;
    news.newsTab       = newsTab;
    news.author_id = authorId;

    news.save(callback);
};
