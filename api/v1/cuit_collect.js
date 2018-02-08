var eventproxy = require('eventproxy');
var CUITProxy   = require('../../proxy').CUIT;
var CUITCollectProxy = require('../../proxy').CUITCollect;
var UserProxy = require('../../proxy').User;
var _ = require('lodash');
var validator    = require('validator');

function list(req, res, next) {
    var loginname = req.params.loginname;
    var ep        = new eventproxy();

    ep.fail(next);

    UserProxy.getUserByLoginName(loginname, ep.done(function (user) {
        if (!user) {
            res.status(404);
            return res.send({success: false, error_msg: '用户不存在'});
        }

        // api 返回 100 条就好了
        CUITCollectProxy.getCUITCollectsByUserId(user._id, {limit: 100}, ep.done('collected_cuits'));

        ep.all('collected_cuits', function (collected_cuits) {

            var ids = collected_cuits.map(function (doc) {
                return String(doc.cuit_id)
            });
            var query = { _id: { '$in': ids } };
            CUITProxy.getCUITsByQuery(query, {}, ep.done('cuits', function (cuits) {
                cuits = _.sortBy(cuits, function (cuit) {
                    return ids.indexOf(String(cuit._id))
                });
                return cuits
            }));

        });

        ep.all('cuits', function (cuits) {
            cuits = cuits.map(function (cuit) {
                cuit.author = _.pick(cuit.author, ['loginname', 'avatar_url']);
                return _.pick(cuit, ['id', 'author_id', 'cuitTab', 'content', 'title', 'last_reply_at',
                    'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);
            });
            res.send({success: true, data: cuits})

        })
    }))
}

exports.list = list;

function collect(req, res, next) {
    var cuit_id = req.body.cuit_id;

    if (!validator.isMongoId(cuit_id)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    CUITProxy.getCUIT(cuit_id, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.status(404);
            return res.json({success: false, error_msg: '话题不存在'});
        }

        CUITCollectProxy.getCUITCollect(req.user.id, cuit._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                res.json({success: false});
                return;
            }

            CUITCollectProxy.newAndSave(req.user.id, cuit._id, function (err) {
                if (err) {
                    return next(err);
                }
                res.json({success: true});
            });
            UserProxy.getUserById(req.user.id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_cuit_count += 1;
                user.save();
            });

            cuit.collect_count += 1;
            cuit.save();
        });
    });
}

exports.collect = collect;

function de_collect(req, res, next) {
    var cuit_id = req.body.cuit_id;

    if (!validator.isMongoId(cuit_id)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    CUITProxy.getCUIT(cuit_id, function (err, cuit) {
        if (err) {
            return next(err);
        }
        if (!cuit) {
            res.status(404);
            return res.json({success: false, error_msg: '话题不存在'});
        }
        CUITCollectProxy.remove(req.user.id, cuit._id, function (err, removeResult) {
            if (err) {
                return next(err);
            }
            if (removeResult.result.n == 0) {
                return res.json({success: false})
            }

            UserProxy.getUserById(req.user.id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_cuit_count -= 1;
                user.save();
            });

            cuit.collect_count -= 1;
            cuit.save();

            res.json({success: true});
        });

    });
}

exports.de_collect = de_collect;
