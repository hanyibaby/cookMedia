var models       = require('../../models');
var ExampleModel   = models.Example;
var ExampleProxy   = require('../../proxy').Example;
var ExampleCollect = require('../../proxy').ExampleCollect;
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
    var exampleTab      = req.query.exampleTab || 'all';
    var limit    = Number(req.query.limit) || config.list_example_count;
    var mdrender = req.query.mdrender === 'false' ? false : true;

    var query = {};
    if (!exampleTab || exampleTab === 'all') {
        query.exampleTab = {$nin: ['job', 'dev']}
    } else {
        if (exampleTab === 'good') {
            query.good = true;
        } else {
            query.exampleTab = exampleTab;
        }
    }
    query.deleted = false;
    var options = { skip: (page - 1) * limit, limit: limit, sort: '-top -last_reply_at'};

    var ep = new eventproxy();
    ep.fail(next);

    ExampleModel.find(query, '', options, ep.done('examples'));

    ep.all('examples', function (examples) {
        examples.forEach(function (example) {
            UserModel.findById(example.author_id, ep.done(function (author) {
                if (mdrender) {
                    example.content = renderHelper.markdown(at.linkUsers(example.content));
                }
                example.author = _.pick(author, ['loginname', 'avatar_url']);
                ep.emit('author');
            }));
        });

        ep.after('author', examples.length, function () {
            examples = examples.map(function (example) {
                return _.pick(example, ['id', 'author_id', 'exampleTab', 'content', 'title', 'last_reply_at',
                    'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);
            });

            res.send({success: true, data: examples});
        });
    });
};

exports.index = index;

var show = function (req, res, next) {
    var exampleId  = String(req.params.id);

    var mdrender = req.query.mdrender === 'false' ? false : true;
    var ep       = new eventproxy();

    if (!validator.isMongoId(exampleId)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    ep.fail(next);

    ExampleProxy.getFullExample(exampleId, ep.done(function (msg, example, author, replies) {
        if (!example) {
            res.status(404);
            return res.send({success: false, error_msg: '话题不存在'});
        }
        example = _.pick(example, ['id', 'author_id', 'exampleTab', 'content', 'title', 'last_reply_at',
            'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);

        if (mdrender) {
            example.content = renderHelper.markdown(at.linkUsers(example.content));
        }
        example.author = _.pick(author, ['loginname', 'avatar_url']);

        example.replies = replies.map(function (reply) {
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

        ep.emit('full_example', example)
    }));


    if (!req.user) {
        ep.emitLater('is_collect', null)
    } else {
        ExampleCollect.getExampleCollect(req.user._id, exampleId, ep.done('is_collect'))
    }

    ep.all('full_example', 'is_collect', function (full_example, is_collect) {
        full_example.is_collect = !!is_collect;

        res.send({success: true, data: full_example});
    })

};

exports.show = show;

var create = function (req, res, next) {
    var title   = validator.trim(req.body.title || '');
    var exampleTab     = validator.trim(req.body.exampleTab || '');
    var content = validator.trim(req.body.content || '');

    // 得到所有的 exampleTab, e.g. ['ask', 'share', ..]
    var allTabs = config.exampleTabs.map(function (tPair) {
        return tPair[0];
    });

    // 验证
    var editError;
    if (title === '') {
        editError = '标题不能为空';
    } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少';
    } else if (!exampleTab || !_.includes(allTabs, exampleTab)) {
        editError = '必须选择一个版块';
    } else if (content === '') {
        editError = '内容不可为空';
    }
    // END 验证

    if (editError) {
        res.status(400);
        return res.send({success: false, error_msg: editError});
    }

    ExampleProxy.newAndSave(title, content, exampleTab, req.user.id, function (err, example) {
        if (err) {
            return next(err);
        }

        var proxy = new eventproxy();
        proxy.fail(next);

        proxy.all('score_saved', function () {
            res.send({
                success: true,
                example_id: example.id
            });
        });
        UserProxy.getUserById(req.user.id, proxy.done(function (user) {
            user.score += 5;
            user.example_count += 1;
            user.save();
            req.user = user;
            proxy.emit('score_saved');
        }));

        //发送at消息
        at.sendMessageToMentionUsers(content, example.id, req.user.id);
    });
};

exports.create = create;

exports.update = function (req, res, next) {
    var example_id = _.trim(req.body.example_id);
    var title    = _.trim(req.body.title);
    var exampleTab      = _.trim(req.body.exampleTab);
    var content  = _.trim(req.body.content);

    // 得到所有的 exampleTab, e.g. ['ask', 'share', ..]
    var allTabs = config.exampleTabs.map(function (tPair) {
        return tPair[0];
    });

    ExampleProxy.getExampleById(example_id, function (err, example, tags) {
        if (!example) {
            res.status(400);
            return res.send({success: false, error_msg: '此话题不存在或已被删除。'});
        }

        if (example.author_id.equals(req.user._id) || req.user.is_admin) {
            // 验证
            var editError;
            if (title === '') {
                editError = '标题不能是空的。';
            } else if (title.length < 5 || title.length > 100) {
                editError = '标题字数太多或太少。';
            } else if (!exampleTab || !_.includes(allTabs, exampleTab)) {
                editError = '必须选择一个版块。';
            }
            // END 验证

            if (editError) {
                return res.send({success: false, error_msg: editError});
            }

            //保存话题
            example.title     = title;
            example.content   = content;
            example.exampleTab       = exampleTab;
            example.update_at = new Date();

            example.save(function (err) {
                if (err) {
                    return next(err);
                }
                //发送at消息
                at.sendMessageToMentionUsers(content, example._id, req.user._id);

                res.send({
                    success: true,
                    example_id: example.id
                });
            });
        } else {
            res.status(403)
            return res.send({success: false, error_msg: '对不起，你不能编辑此话题。'});
        }
    });
};

