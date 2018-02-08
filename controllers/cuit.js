/**
 * Created by 仙客来 on 2018/1/27.
 */
var validator = require('validator');

var at           = require('../common/at');
var User         = require('../proxy').User;
var CUIT        = require('../proxy').CUIT;
var CUITCollect = require('../proxy').CUITCollect;
var EventProxy   = require('eventproxy');
var tools        = require('../common/tools');
var store        = require('../common/store');
var config       = require('../config');
var _            = require('lodash');
var cache        = require('../common/cache');
var logger = require('../common/logger')

/**
 * CUIT page
 *
 * @param  {HttpRequest} req
 * @param  {HttpResponse} res
 * @param  {Function} next
 */
exports.index = function (req, res, next) {
    function isUped(user, reply) {
        if (!reply.ups) {
            return false;
        }
        return reply.ups.indexOf(user._id) !== -1;
    }

    var cuit_id = req.params.tid;
    var currentUser = req.session.user;

    if (cuit_id.length !== 24) {
        return res.render404('此话题不存在或已被删除。');
    }
    var events = ['cuit', 'other_cuits', 'no_reply_cuits', 'is_collect'];
    var ep = EventProxy.create(events,
        function (cuit, other_cuits, no_reply_cuits, is_collect) {
            res.render('cuit/index', {
                cuit: cuit,
                author_other_cuits: other_cuits,
                no_reply_cuits: no_reply_cuits,
                is_uped: isUped,
                is_collect: is_collect,
            });
        });

    ep.fail(next);

    CUIT.getFullCUIT(cuit_id, ep.done(function (message, cuit, author, replies) {
        if (message) {
            logger.error('getFullCUIT error cuit_id: ' + cuit_id)
            return res.renderError(message);
        }

        cuit.visit_count += 1;
        cuit.save();

        cuit.author  = author;
        cuit.replies = replies;

        // 点赞数排名第三的回答，它的点赞数就是阈值
        cuit.reply_up_threshold = (function () {
            var allUpCount = replies.map(function (reply) {
                return reply.ups && reply.ups.length || 0;
            });
            allUpCount = _.sortBy(allUpCount, Number).reverse();

            var threshold = allUpCount[2] || 0;
            if (threshold < 3) {
                threshold = 3;
            }
            return threshold;
        })();

        ep.emit('cuit', cuit);

        // get other_cuits
        var options = { limit: 5, sort: '-last_reply_at'};
        var query = { author_id: cuit.author_id, _id: { '$nin': [ cuit._id ] } };
        CUIT.getCUITsByQuery(query, options, ep.done('other_cuits'));

        // get no_reply_cuits
        cache.get('no_reply_cuits', ep.done(function (no_reply_cuits) {
            if (no_reply_cuits) {
                ep.emit('no_reply_cuits', no_reply_cuits);
            } else {
                CUIT.getCUITsByQuery(
                    { reply_count: 0, cuitTab: {$nin: ['job', 'dev']}},
                    { limit: 5, sort: '-create_at'},
                    ep.done('no_reply_cuits', function (no_reply_cuits) {
                        cache.set('no_reply_cuits', no_reply_cuits, 60 * 1);
                        return no_reply_cuits;
                    }));
            }
        }));
    }));

    if (!currentUser) {
        ep.emit('is_collect', null);
    } else {
        CUITCollect.getCUITCollect(currentUser._id, cuit_id, ep.done('is_collect'))
    }
};

exports.create = function (req, res, next) {
    res.render('cuit/edit', {
        cuitTabs: config.CUITTabs
    });
};


exports.put = function (req, res, next) {
    var title   = validator.trim(req.body.title);
    var cuitTab     = validator.trim(req.body.cuitTab);
    var content = validator.trim(req.body.t_content);

    // 得到所有的 cuitTab, e.g. ['ask', 'share', ..]
    var allTabs = config.CUITTabs.map(function (tPair) {
        return tPair[0];
    });

    // 验证
    var editError;
    if (title === '') {
        editError = '标题不能是空的。';
    } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少。';
    } else if (!cuitTab || allTabs.indexOf(cuitTab) === -1) {
        editError = '必须选择一个版块。';
    } else if (content === '') {
        editError = '内容不可为空';
    }
    // END 验证

    if (editError) {
        res.status(422);
        return res.render('cuit/edit', {
            edit_error: editError,
            title: title,
            content: content,
            cuitTabs: config.CUITTabs
        });
    }

    CUIT.newAndSave(title, content, cuitTab, req.session.user._id, function (err, cuit) {
        if (err) {
            return next(err);
        }

        var proxy = new EventProxy();

        proxy.all('score_saved', function () {
            res.redirect('/cuit/' + cuit._id);
        });
        proxy.fail(next);
        User.getUserById(req.session.user._id, proxy.done(function (user) {
            user.score += 5;
            user.cuit_count += 1;
            user.save();
            req.session.user = user;
            proxy.emit('score_saved');
        }));

        //发送at消息
        at.sendMessageToMentionUsers(content, cuit._id, req.session.user._id);
    });
};

exports.showEdit = function (req, res, next) {
    var cuit_id = req.params.tid;

    CUIT.getCUITById(cuit_id, function (err, cuit, tags) {
        if (!cuit) {
            res.render404('此话题不存在或已被删除。');
            return;
        }

        if (String(cuit.author_id) === String(req.session.user._id) || req.session.user.is_admin) {
            res.render('cuit/edit', {
                action: 'edit',
                cuit_id: cuit._id,
                title: cuit.title,
                content: cuit.content,
                cuitTab: cuit.cuitTab,
                cuitTabs: config.CUITTabs
            });
        } else {
            res.renderError('对不起，你不能编辑此话题。', 403);
        }
    });
};

exports.update = function (req, res, next) {
    var cuit_id = req.params.tid;
    var title    = req.body.title;
    var cuitTab      = req.body.cuitTab;
    var content  = req.body.t_content;

    CUIT.getCUITById(cuit_id, function (err, cuit, tags) {
        if (!cuit) {
            res.render404('此话题不存在或已被删除。');
            return;
        }

        if (cuit.author_id.equals(req.session.user._id) || req.session.user.is_admin) {
            title   = validator.trim(title);
            cuitTab     = validator.trim(cuitTab);
            content = validator.trim(content);

            // 验证
            var editError;
            if (title === '') {
                editError = '标题不能是空的。';
            } else if (title.length < 5 || title.length > 100) {
                editError = '标题字数太多或太少。';
            } else if (!cuitTab) {
                editError = '必须选择一个版块。';
            }
            // END 验证

            if (editError) {
                return res.render('cuit/edit', {
                    action: 'edit',
                    edit_error: editError,
                    cuit_id: cuit._id,
                    content: content,
                    cuitTabs: config.CUITTabs
                });
            }

            //保存话题
            cuit.title     = title;
            cuit.content   = content;
            cuit.cuitTab       = cuitTab;
            cuit.update_at = new Date();

            cuit.save(function (err) {
                if (err) {
                    return next(err);
                }
                //发送at消息
                at.sendMessageToMentionUsers(content, cuit._id, req.session.user._id);

                res.redirect('/cuit/' + cuit._id);

            });
        } else {
            res.renderError('对不起，你不能编辑此话题。', 403);
        }
    });
};

exports.delete = function (req, res, next) {
    //删除话题, 话题作者cuit_count减1
    //删除回复，回复作者reply_count减1
    //删除cuit_collect，用户collect_cuit_count减1

    var cuit_id = req.params.tid;

    CUIT.getFullCUIT(cuit_id, function (err, err_msg, cuit, author, replies) {
        if (err) {
            return res.send({ success: false, message: err.message });
        }
        if (!req.session.user.is_admin && !(cuit.author_id.equals(req.session.user._id))) {
            res.status(403);
            return res.send({success: false, message: '无权限'});
        }
        if (!cuit) {
            res.status(422);
            return res.send({ success: false, message: '此话题不存在或已被删除。' });
        }
        author.score -= 5;
        author.cuit_count -= 1;
        author.save();

        cuit.deleted = true;
        cuit.save(function (err) {
            if (err) {
                return res.send({ success: false, message: err.message });
            }
            res.send({ success: true, message: '话题已被删除。' });
        });
    });
};

// 设为置顶
exports.top = function (req, res, next) {
    var cuit_id = req.params.tid;
    var referer  = req.get('referer');

    if (cuit_id.length !== 24) {
        res.render404('此话题不存在或已被删除。');
        return;
    }
    CUIT.getCUIT(cuit_id, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        cuit.top = !cuit.top;
        cuit.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = cuit.top ? '此话题已置顶。' : '此话题已取消置顶。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 设为精华
exports.good = function (req, res, next) {
    var cuitId = req.params.tid;
    var referer = req.get('referer');

    CUIT.getCUIT(cuitId, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        cuit.good = !cuit.good;
        cuit.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = cuit.good ? '此话题已加精。' : '此话题已取消加精。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 锁定主题，不可再回复
exports.lock = function (req, res, next) {
    var cuitId = req.params.tid;
    var referer = req.get('referer');
    CUIT.getCUIT(cuitId, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        cuit.lock = !cuit.lock;
        cuit.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = cuit.lock ? '此话题已锁定。' : '此话题已取消锁定。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 收藏主题
exports.collect = function (req, res, next) {
    var cuit_id = req.body.cuit_id;

    CUIT.getCUIT(cuit_id, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.json({status: 'failed'});
        }

        CUITCollect.getCUITCollect(req.session.user._id, cuit._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                res.json({status: 'failed'});
                return;
            }

            CUITCollect.newAndSave(req.session.user._id, cuit._id, function (err) {
                if (err) {
                    return next(err);
                }
                res.json({status: 'success'});
            });
            User.getUserById(req.session.user._id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_cuit_count += 1;
                user.save();
            });

            req.session.user.collect_cuit_count += 1;
            cuit.collect_count += 1;
            cuit.save();
        });
    });
};

exports.de_collect = function (req, res, next) {
    var cuit_id = req.body.cuit_id;
    CUIT.getCUIT(cuit_id, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.json({status: 'failed'});
        }
        CUITCollect.remove(req.session.user._id, cuit._id, function (err, removeResult) {
            if (err) {
                return next(err);
            }
            if (removeResult.result.n == 0) {
                return res.json({status: 'failed'})
            }

            User.getUserById(req.session.user._id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_cuit_count -= 1;
                req.session.user = user;
                user.save();
            });

            cuit.collect_count -= 1;
            cuit.save();

            res.json({status: 'success'});
        });
    });
};

exports.upload = function (req, res, next) {
    var isFileLimit = false;
    req.busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
        file.on('limit', function () {
            isFileLimit = true;

            res.json({
                success: false,
                msg: 'File size too large. Max is ' + config.file_limit
            })
        });

        store.upload(file, {filename: filename}, function (err, result) {
            if (err) {
                return next(err);
            }
            if (isFileLimit) {
                return;
            }
            res.json({
                success: true,
                url: result.url,
            });
        });

    });

    req.pipe(req.busboy);
};
