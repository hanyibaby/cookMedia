var models       = require('../../models');
var CUITModel   = models.CUIT;
var CUITProxy   = require('../../proxy').CUIT;
var CUITCollect = require('../../proxy').CUITCollect;
var UserProxy    = require('../../proxy').User;
var UserModel    = models.User;
var config       = require('../../config');
var eventproxy   = require('eventproxy');
var _            = require('lodash');
var at           = require('../../common/at');
var renderHelper = require('../../common/render_helper');
var validator    = require('validator');

var index = function (req, res, next) {
    var page     = parseInt(req.query.page, 10) || 1;
    page         = page > 0 ? page : 1;
    var cuitTab      = req.query.cuitTab || 'all';
    var limit    = Number(req.query.limit) || config.list_cuit_count;
    var mdrender = req.query.mdrender === 'false' ? false : true;

    var query = {};
    if (!cuitTab || cuitTab === 'all') {
        query.cuitTab = {$nin: ['job', 'dev']}
    } else {
        if (cuitTab === 'good') {
            query.good = true;
        } else {
            query.cuitTab = cuitTab;
        }
    }
    query.deleted = false;
    var options = { skip: (page - 1) * limit, limit: limit, sort: '-top -last_reply_at'};

    var ep = new eventproxy();
    ep.fail(next);

    CUITModel.find(query, '', options, ep.done('cuits'));

    ep.all('cuits', function (cuits) {
        cuits.forEach(function (cuit) {
            UserModel.findById(cuit.author_id, ep.done(function (author) {
                if (mdrender) {
                    cuit.content = renderHelper.markdown(at.linkUsers(cuit.content));
                }
                cuit.author = _.pick(author, ['loginname', 'avatar_url']);
                ep.emit('author');
            }));
        });

        ep.after('author', cuits.length, function () {
            cuits = cuits.map(function (cuit) {
                return _.pick(cuit, ['id', 'author_id', 'cuitTab', 'content', 'title', 'last_reply_at',
                    'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);
            });

            res.send({success: true, data: cuits});
        });
    });
};

exports.index = index;

var show = function (req, res, next) {
    var cuitId  = String(req.params.id);

    var mdrender = req.query.mdrender === 'false' ? false : true;
    var ep       = new eventproxy();

    if (!validator.isMongoId(cuitId)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    ep.fail(next);

    CUITProxy.getFullCUIT(cuitId, ep.done(function (msg, cuit, author, replies) {
        if (!cuit) {
            res.status(404);
            return res.send({success: false, error_msg: '话题不存在'});
        }
        cuit = _.pick(cuit, ['id', 'author_id', 'cuitTab', 'content', 'title', 'last_reply_at',
            'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);

        if (mdrender) {
            cuit.content = renderHelper.markdown(at.linkUsers(cuit.content));
        }
        cuit.author = _.pick(author, ['loginname', 'avatar_url']);

        cuit.replies = replies.map(function (reply) {
            if (mdrender) {
                reply.content = renderHelper.markdown(at.linkUsers(reply.content));
            }
            reply.author = _.pick(reply.author, ['loginname', 'avatar_url']);
            reply =  _.pick(reply, ['id', 'author', 'content', 'ups', 'create_at', 'reply_id']);
            reply.reply_id = reply.reply_id || null;

            if (reply.ups && req.user && reply.ups.indexOf(req.user.id) != -1) {
                reply.is_uped = true;
            } else {
                reply.is_uped = false;
            }

            return reply;
        });

        ep.emit('full_cuit', cuit)
    }));


    if (!req.user) {
        ep.emitLater('is_collect', null)
    } else {
        CUITCollect.getCUITCollect(req.user._id, cuitId, ep.done('is_collect'))
    }

    ep.all('full_cuit', 'is_collect', function (full_cuit, is_collect) {
        full_cuit.is_collect = !!is_collect;

        res.send({success: true, data: full_cuit});
    })

};

exports.show = show;

var create = function (req, res, next) {
    var title   = validator.trim(req.body.title || '');
    var cuitTab     = validator.trim(req.body.cuitTab || '');
    var content = validator.trim(req.body.content || '');

    // 得到所有的 cuitTab, e.g. ['ask', 'share', ..]
    var allTabs = config.CUITTabs.map(function (tPair) {
        return tPair[0];
    });

    // 验证
    var editError;
    if (title === '') {
        editError = '标题不能为空';
    } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少';
    } else if (!cuitTab || !_.includes(allTabs, cuitTab)) {
        editError = '必须选择一个版块';
    } else if (content === '') {
        editError = '内容不可为空';
    }
    // END 验证

    if (editError) {
        res.status(400);
        return res.send({success: false, error_msg: editError});
    }

    CUITProxy.newAndSave(title, content, cuitTab, req.user.id, function (err, cuit) {
        if (err) {
            return next(err);
        }

        var proxy = new eventproxy();
        proxy.fail(next);

        proxy.all('score_saved', function () {
            res.send({
                success: true,
                cuit_id: cuit.id
            });
        });
        UserProxy.getUserById(req.user.id, proxy.done(function (user) {
            user.score += 5;
            user.cuit_count += 1;
            user.save();
            req.user = user;
            proxy.emit('score_saved');
        }));

        //发送at消息
        at.sendMessageToMentionUsers(content, cuit.id, req.user.id);
    });
};

exports.create = create;

exports.update = function (req, res, next) {
    var cuit_id = _.trim(req.body.cuit_id);
    var title    = _.trim(req.body.title);
    var cuitTab      = _.trim(req.body.cuitTab);
    var content  = _.trim(req.body.content);

    // 得到所有的 cuitTab, e.g. ['ask', 'share', ..]
    var allTabs = config.CUITTabs.map(function (tPair) {
        return tPair[0];
    });

    CUITProxy.getCUITById(cuit_id, function (err, cuit, tags) {
        if (!cuit) {
            res.status(400);
            return res.send({success: false, error_msg: '此话题不存在或已被删除。'});
        }

        if (cuit.author_id.equals(req.user._id) || req.user.is_admin) {
            // 验证
            var editError;
            if (title === '') {
                editError = '标题不能是空的。';
            } else if (title.length < 5 || title.length > 100) {
                editError = '标题字数太多或太少。';
            } else if (!cuitTab || !_.includes(allTabs, cuitTab)) {
                editError = '必须选择一个版块。';
            }
            // END 验证

            if (editError) {
                return res.send({success: false, error_msg: editError});
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
                at.sendMessageToMentionUsers(content, cuit._id, req.user._id);

                res.send({
                    success: true,
                    cuit_id: cuit.id
                });
            });
        } else {
            res.status(403)
            return res.send({success: false, error_msg: '对不起，你不能编辑此话题。'});
        }
    });
};

