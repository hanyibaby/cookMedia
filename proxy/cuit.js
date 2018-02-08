/**
 * Created by 仙客来 on 2018/1/27.
 */
var EventProxy = require('eventproxy');
var models     = require('../models');
var CUIT      = models.CUIT;
var User       = require('./user');
var Reply      = require('./reply');
var tools      = require('../common/tools');
var at         = require('../common/at');
var _          = require('lodash');


/**
 * 根据主题ID获取主题
 * Callback:
 * - err, 数据库错误
 * - cuit, 主题
 * - author, 作者
 * - lastReply, 最后回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getCUITById = function (id, callback) {
    var proxy = new EventProxy();
    var events = ['cuit', 'author', 'last_reply'];
    proxy.assign(events, function (cuit, author, last_reply) {
        if (!author) {
            return callback(null, null, null, null);
        }
        return callback(null, cuit, author, last_reply);
    }).fail(callback);

    CUIT.findOne({_id: id}, proxy.done(function (cuit) {
        if (!cuit) {
            proxy.emit('cuit', null);
            proxy.emit('author', null);
            proxy.emit('last_reply', null);
            return;
        }
        proxy.emit('cuit', cuit);

        User.getUserById(cuit.author_id, proxy.done('author'));

        if (cuit.last_reply) {
            Reply.getReplyById(cuit.last_reply, proxy.done(function (last_reply) {
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
    CUIT.count(query, callback);
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
exports.getCUITsByQuery = function (query, opt, callback) {
    query.deleted = false;
    CUIT.find(query, {}, opt, function (err, cuits) {
        if (err) {
            return callback(err);
        }
        if (cuits.length === 0) {
            return callback(null, []);
        }

        var proxy = new EventProxy();
        proxy.after('cuit_ready', cuits.length, function () {
            cuits = _.compact(cuits); // 删除不合规的 cuit
            return callback(null, cuits);
        });
        proxy.fail(callback);

        cuits.forEach(function (cuit, i) {
            var ep = new EventProxy();
            ep.all('author', 'reply', function (author, reply) {
                // 保证顺序
                // 作者可能已被删除
                if (author) {
                    cuit.author = author;
                    cuit.reply = reply;
                } else {
                    cuits[i] = null;
                }
                proxy.emit('cuit_ready');
            });

            User.getUserById(cuit.author_id, ep.done('author'));
            // 获取主题的最后回复
            Reply.getReplyById(cuit.last_reply, ep.done('reply'));
        });
    });
};

// for sitemap
exports.getLimit5w = function (callback) {
    CUIT.find({deleted: false}, '_id', {limit: 50000, sort: '-create_at'}, callback);
};

/**
 * 获取所有信息的主题
 * Callback:
 * - err, 数据库异常
 * - message, 消息
 * - cuit, 主题
 * - author, 主题作者
 * - replies, 主题的回复
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getFullCUIT = function (id, callback) {
    var proxy = new EventProxy();
    var events = ['cuit', 'author', 'replies'];
    proxy
        .assign(events, function (cuit, author, replies) {
            callback(null, '', cuit, author, replies);
        })
        .fail(callback);

    CUIT.findOne({_id: id, deleted: false}, proxy.done(function (cuit) {
        if (!cuit) {
            proxy.unbind();
            return callback(null, '此话题不存在或已被删除。');
        }
        at.linkUsers(cuit.content, proxy.done('cuit', function (str) {
            cuit.linkedContent = str;
            return cuit;
        }));

        User.getUserById(cuit.author_id, proxy.done(function (author) {
            if (!author) {
                proxy.unbind();
                return callback(null, '话题的作者丢了。');
            }
            proxy.emit('author', author);
        }));

        Reply.getRepliesByCUITId(cuit._id, proxy.done('replies'));
    }));
};

/**
 * 更新主题的最后回复信息
 * @param {String} cuitId 主题ID
 * @param {String} replyId 回复ID
 * @param {Function} callback 回调函数
 */
exports.updateLastReply = function (cuitId, replyId, callback) {
    CUIT.findOne({_id: cuitId}, function (err, cuit) {
        if (err || !cuit) {
            return callback(err);
        }
        cuit.last_reply    = replyId;
        cuit.last_reply_at = new Date();
        cuit.reply_count += 1;
        cuit.save(callback);
    });
};

/**
 * 根据主题ID，查找一条主题
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.getCUIT = function (id, callback) {
    CUIT.findOne({_id: id}, callback);
};

/**
 * 将当前主题的回复计数减1，并且更新最后回复的用户，删除回复时用到
 * @param {String} id 主题ID
 * @param {Function} callback 回调函数
 */
exports.reduceCount = function (id, callback) {
    CUIT.findOne({_id: id}, function (err, cuit) {
        if (err) {
            return callback(err);
        }

        if (!cuit) {
            return callback(new Error('该主题不存在'));
        }
        cuit.reply_count -= 1;

        Reply.getLastReplyByTopId(id, function (err, reply) {
            if (err) {
                return callback(err);
            }

            if (reply.length !== 0) {
                cuit.last_reply = reply[0]._id;
            } else {
                cuit.last_reply = null;
            }

            cuit.save(callback);
        });

    });
};

exports.newAndSave = function (title, content, cuitTab, authorId, callback) {
    var cuit       = new CUIT();
    cuit.title     = title;
    cuit.content   = content;
    cuit.cuitTab       = cuitTab;
    cuit.author_id = authorId;

    cuit.save(callback);
};
