var EventProxy = require('eventproxy');
var models     = require('../models');
var Example      = models.Example;
var User       = require('./user');
var Reply      = require('./reply');
var tools      = require('../common/tools');
var at         = require('../common/at');
var _          = require('lodash');


/**
 * 根据主题ID获取主题
 * Callback:
 * - err, 数据库错误
 * - example, 主题
 * - author, 作者
 * - lastReply, 最后回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getExampleById = function (id, callback) {
    var proxy = new EventProxy();
    var events = ['example', 'author', 'last_reply'];
    proxy.assign(events, function (example, author, last_reply) {
        if (!author) {
            return callback(null, null, null, null);
        }
        return callback(null, example, author, last_reply);
    }).fail(callback);

    Example.findOne({_id: id}, proxy.done(function (example) {
        if (!example) {
            proxy.emit('example', null);
            proxy.emit('author', null);
            proxy.emit('last_reply', null);
            return;
        }
        proxy.emit('example', example);

        User.getUserById(example.author_id, proxy.done('author'));

        if (example.last_reply) {
            Reply.getReplyById(example.last_reply, proxy.done(function (last_reply) {
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
    Example.count(query, callback);
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
exports.getExamplesByQuery = function (query, opt, callback) {
    query.deleted = false;
    Example.find(query, {}, opt, function (err, examples) {
        if (err) {
            return callback(err);
        }
        if (examples.length === 0) {
            return callback(null, []);
        }

        var proxy = new EventProxy();
        proxy.after('example_ready', examples.length, function () {
            examples = _.compact(examples); // 删除不合规的 example
            return callback(null, examples);
        });
        proxy.fail(callback);

        examples.forEach(function (example, i) {
            var ep = new EventProxy();
            ep.all('author', 'reply', function (author, reply) {
                // 保证顺序
                // 作者可能已被删除
                if (author) {
                    example.author = author;
                    example.reply = reply;
                } else {
                    examples[i] = null;
                }
                proxy.emit('example_ready');
            });

            User.getUserById(example.author_id, ep.done('author'));
            // 获取主题的最后回复
            Reply.getReplyById(example.last_reply, ep.done('reply'));
        });
    });
};

// for sitemap
exports.getLimit5w = function (callback) {
    Example.find({deleted: false}, '_id', {limit: 50000, sort: '-create_at'}, callback);
};

/**
 * 获取所有信息的主题
 * Callback:
 * - err, 数据库异常
 * - message, 消息
 * - example, 主题
 * - author, 主题作者
 * - replies, 主题的回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getFullExample = function (id, callback) {
    var proxy = new EventProxy();
    var events = ['example', 'author', 'replies'];
    proxy
        .assign(events, function (example, author, replies) {
            callback(null, '', example, author, replies);
        })
        .fail(callback);

    Example.findOne({_id: id, deleted: false}, proxy.done(function (example) {
        if (!example) {
            proxy.unbind();
            return callback(null, '此话题不存在或已被删除。');
        }
        at.linkUsers(example.content, proxy.done('example', function (str) {
            example.linkedContent = str;
            return example;
        }));

        User.getUserById(example.author_id, proxy.done(function (author) {
            if (!author) {
                proxy.unbind();
                return callback(null, '话题的作者丢了。');
            }
            proxy.emit('author', author);
        }));

        Reply.getRepliesByExampleId(example._id, proxy.done('replies'));
    }));
};

/**
 * 更新主题的最后回复信息
 * @param {String} exampleId 主题ID
 * @param {String} replyId 回复ID
 * @param {Function} callback 回调函数
 */
exports.updateLastReply = function (exampleId, replyId, callback) {
    Example.findOne({_id: exampleId}, function (err, example) {
        if (err || !example) {
            return callback(err);
        }
        example.last_reply    = replyId;
        example.last_reply_at = new Date();
        example.reply_count += 1;
        example.save(callback);
    });
};

/**
 * 根据主题ID，查找一条主题
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getExample = function (id, callback) {
    Example.findOne({_id: id}, callback);
};

/**
 * 将当前主题的回复计数减1，并且更新最后回复的用户，删除回复时用到
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.reduceCount = function (id, callback) {
    Example.findOne({_id: id}, function (err, example) {
        if (err) {
            return callback(err);
        }

        if (!example) {
            return callback(new Error('该主题不存在'));
        }
        example.reply_count -= 1;

        Reply.getLastReplyByTopId(id, function (err, reply) {
            if (err) {
                return callback(err);
            }

            if (reply.length !== 0) {
                example.last_reply = reply[0]._id;
            } else {
                example.last_reply = null;
            }

            example.save(callback);
        });

    });
};

exports.newAndSave = function (title, content, exampleTab, authorId, callback) {
    var example       = new Example();
    example.title     = title;
    example.content   = content;
    example.exampleTab       = exampleTab;
    example.author_id = authorId;

    example.save(callback);
};
