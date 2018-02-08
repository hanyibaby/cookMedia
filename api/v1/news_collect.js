var eventproxy = require('eventproxy');
var NewsProxy   = require('../../proxy').News;
var NewsCollectProxy = require('../../proxy').NewsCollect;
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
        NewsCollectProxy.getNewsCollectsByUserId(user._id, {limit: 100}, ep.done('collected_newss'));

        ep.all('collected_newss', function (collected_newss) {

            var ids = collected_newss.map(function (doc) {
                return String(doc.news_id)
            });
            var query = { _id: { '$in': ids } };
            NewsProxy.getNewssByQuery(query, {}, ep.done('newss', function (newss) {
                newss = _.sortBy(newss, function (news) {
                    return ids.indexOf(String(news._id))
                });
                return newss
            }));

        });

        ep.all('newss', function (newss) {
            newss = newss.map(function (news) {
                news.author = _.pick(news.author, ['loginname', 'avatar_url']);
                return _.pick(news, ['id', 'author_id', 'newsTab', 'content', 'title', 'last_reply_at',
                    'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);
            });
            res.send({success: true, data: newss})

        })
    }))
}

exports.list = list;

function collect(req, res, next) {
    var news_id = req.body.news_id;

    if (!validator.isMongoId(news_id)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    NewsProxy.getNews(news_id, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.status(404);
            return res.json({success: false, error_msg: '话题不存在'});
        }

        NewsCollectProxy.getNewsCollect(req.user.id, news._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                res.json({success: false});
                return;
            }

            NewsCollectProxy.newAndSave(req.user.id, news._id, function (err) {
                if (err) {
                    return next(err);
                }
                res.json({success: true});
            });
            UserProxy.getUserById(req.user.id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_news_count += 1;
                user.save();
            });

            news.collect_count += 1;
            news.save();
        });
    });
}

exports.collect = collect;

function de_collect(req, res, next) {
    var news_id = req.body.news_id;

    if (!validator.isMongoId(news_id)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    NewsProxy.getNews(news_id, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.status(404);
            return res.json({success: false, error_msg: '话题不存在'});
        }
        NewsCollectProxy.remove(req.user.id, news._id, function (err, removeResult) {
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
                user.collect_news_count -= 1;
                user.save();
            });

            news.collect_count -= 1;
            news.save();

            res.json({success: true});
        });

    });
}

exports.de_collect = de_collect;
