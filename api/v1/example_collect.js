var eventproxy = require('eventproxy');
var ExampleProxy   = require('../../proxy').Example;
var ExampleCollectProxy = require('../../proxy').ExampleCollect;
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
        ExampleCollectProxy.getExampleCollectsByUserId(user._id, {limit: 100}, ep.done('collected_examples'));

        ep.all('collected_examples', function (collected_examples) {

            var ids = collected_examples.map(function (doc) {
                return String(doc.example_id)
            });
            var query = { _id: { '$in': ids } };
            ExampleProxy.getExamplesByQuery(query, {}, ep.done('examples', function (examples) {
                examples = _.sortBy(examples, function (example) {
                    return ids.indexOf(String(example._id))
                });
                return examples
            }));

        });

        ep.all('examples', function (examples) {
            examples = examples.map(function (example) {
                example.author = _.pick(example.author, ['loginname', 'avatar_url']);
                return _.pick(example, ['id', 'author_id', 'exampleTab', 'content', 'title', 'last_reply_at',
                    'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);
            });
            res.send({success: true, data: examples})

        })
    }))
}

exports.list = list;

function collect(req, res, next) {
    var example_id = req.body.example_id;

    if (!validator.isMongoId(example_id)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    ExampleProxy.getExample(example_id, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.status(404);
            return res.json({success: false, error_msg: '话题不存在'});
        }

        ExampleCollectProxy.getExampleCollect(req.user.id, example._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                res.json({success: false});
                return;
            }

            ExampleCollectProxy.newAndSave(req.user.id, example._id, function (err) {
                if (err) {
                    return next(err);
                }
                res.json({success: true});
            });
            UserProxy.getUserById(req.user.id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_example_count += 1;
                user.save();
            });

            example.collect_count += 1;
            example.save();
        });
    });
}

exports.collect = collect;

function de_collect(req, res, next) {
    var example_id = req.body.example_id;

    if (!validator.isMongoId(example_id)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    ExampleProxy.getExample(example_id, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.status(404);
            return res.json({success: false, error_msg: '话题不存在'});
        }
        ExampleCollectProxy.remove(req.user.id, example._id, function (err, removeResult) {
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
                user.collect_example_count -= 1;
                user.save();
            });

            example.collect_count -= 1;
            example.save();

            res.json({success: true});
        });

    });
}

exports.de_collect = de_collect;
