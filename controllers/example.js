var validator = require('validator');

var at           = require('../common/at');
var User         = require('../proxy').User;
var Example        = require('../proxy').Example;
var ExampleCollect = require('../proxy').ExampleCollect;
var EventProxy   = require('eventproxy');
var tools        = require('../common/tools');
var store        = require('../common/store');
var config       = require('../config');
var _            = require('lodash');
var cache        = require('../common/cache');
var logger = require('../common/logger')

/**
 * Example page
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

    var example_id = req.params.tid;
    var currentUser = req.session.user;

    if (example_id.length !== 24) {
        return res.render404('此话题不存在或已被删除。');
    }
    var events = ['example', 'other_examples', 'no_reply_examples', 'is_collect'];
    var ep = EventProxy.create(events,
        function (example, other_examples, no_reply_examples, is_collect) {
            res.render('example/index', {
                example: example,
                author_other_examples: other_examples,
                no_reply_examples: no_reply_examples,
                is_uped: isUped,
                is_collect: is_collect,
            });
        });

    ep.fail(next);

    Example.getFullExample(example_id, ep.done(function (message, example, author, replies) {
        if (message) {
            logger.error('getFullExample error example_id: ' + example_id)
            return res.renderError(message);
        }

        example.visit_count += 1;
        example.save();

        example.author  = author;
        example.replies = replies;

        // 点赞数排名第三的回答，它的点赞数就是阈值
        example.reply_up_threshold = (function () {
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

        ep.emit('example', example);

        // get other_examples
        var options = { limit: 5, sort: '-last_reply_at'};
        var query = { author_id: example.author_id, _id: { '$nin': [ example._id ] } };
        Example.getExamplesByQuery(query, options, ep.done('other_examples'));

        // get no_reply_examples
        cache.get('no_reply_examples', ep.done(function (no_reply_examples) {
            if (no_reply_examples) {
                ep.emit('no_reply_examples', no_reply_examples);
            } else {
                Example.getExamplesByQuery(
                    { reply_count: 0, exampleTab: {$nin: ['job', 'dev']}},
                    { limit: 5, sort: '-create_at'},
                    ep.done('no_reply_examples', function (no_reply_examples) {
                        cache.set('no_reply_examples', no_reply_examples, 60 * 1);
                        return no_reply_examples;
                    }));
            }
        }));
    }));

    if (!currentUser) {
        ep.emit('is_collect', null);
    } else {
        ExampleCollect.getExampleCollect(currentUser._id, example_id, ep.done('is_collect'))
    }
};

exports.create = function (req, res, next) {
    res.render('example/edit', {
        exampleTabs: config.exampleTabs
    });
};


exports.put = function (req, res, next) {
    var title   = validator.trim(req.body.title);
    var exampleTab     = validator.trim(req.body.exampleTab);
    var content = validator.trim(req.body.t_content);

    // 得到所有的 exampleTab, e.g. ['ask', 'share', ..]
    var allTabs = config.exampleTabs.map(function (tPair) {
        return tPair[0];
    });

    // 验证
    var editError;
    if (title === '') {
        editError = '标题不能是空的。';
    } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少。';
    } else if (!exampleTab || allTabs.indexOf(exampleTab) === -1) {
        editError = '必须选择一个版块。';
    } else if (content === '') {
        editError = '内容不可为空';
    }
    // END 验证

    if (editError) {
        res.status(422);
        return res.render('example/edit', {
            edit_error: editError,
            title: title,
            content: content,
            exampleTabs: config.exampleTabs
        });
    }

    Example.newAndSave(title, content, exampleTab, req.session.user._id, function (err, example) {
        if (err) {
            return next(err);
        }

        var proxy = new EventProxy();

        proxy.all('score_saved', function () {
            res.redirect('/example/' + example._id);
        });
        proxy.fail(next);
        User.getUserById(req.session.user._id, proxy.done(function (user) {
            user.score += 5;
            user.example_count += 1;
            user.save();
            req.session.user = user;
            proxy.emit('score_saved');
        }));

        //发送at消息
        at.sendMessageToMentionUsers(content, example._id, req.session.user._id);
    });
};

exports.showEdit = function (req, res, next) {
    var example_id = req.params.tid;

    Example.getExampleById(example_id, function (err, example, tags) {
        if (!example) {
            res.render404('此话题不存在或已被删除。');
            return;
        }

        if (String(example.author_id) === String(req.session.user._id) || req.session.user.is_admin) {
            res.render('example/edit', {
                action: 'edit',
                example_id: example._id,
                title: example.title,
                content: example.content,
                exampleTab: example.exampleTab,
                exampleTabs: config.exampleTabs
            });
        } else {
            res.renderError('对不起，你不能编辑此话题。', 403);
        }
    });
};

exports.update = function (req, res, next) {
    var example_id = req.params.tid;
    var title    = req.body.title;
    var exampleTab      = req.body.exampleTab;
    var content  = req.body.t_content;

    Example.getExampleById(example_id, function (err, example, tags) {
        if (!example) {
            res.render404('此话题不存在或已被删除。');
            return;
        }

        if (example.author_id.equals(req.session.user._id) || req.session.user.is_admin) {
            title   = validator.trim(title);
            exampleTab     = validator.trim(exampleTab);
            content = validator.trim(content);

            // 验证
            var editError;
            if (title === '') {
                editError = '标题不能是空的。';
            } else if (title.length < 5 || title.length > 100) {
                editError = '标题字数太多或太少。';
            } else if (!exampleTab) {
                editError = '必须选择一个版块。';
            }
            // END 验证

            if (editError) {
                return res.render('example/edit', {
                    action: 'edit',
                    edit_error: editError,
                    example_id: example._id,
                    content: content,
                    exampleTabs: config.exampleTabs
                });
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
                at.sendMessageToMentionUsers(content, example._id, req.session.user._id);

                res.redirect('/example/' + example._id);

            });
        } else {
            res.renderError('对不起，你不能编辑此话题。', 403);
        }
    });
};

exports.delete = function (req, res, next) {
    //删除话题, 话题作者example_count减1
    //删除回复，回复作者reply_count减1
    //删除example_collect，用户collect_example_count减1

    var example_id = req.params.tid;

    Example.getFullExample(example_id, function (err, err_msg, example, author, replies) {
        if (err) {
            return res.send({ success: false, message: err.message });
        }
        if (!req.session.user.is_admin && !(example.author_id.equals(req.session.user._id))) {
            res.status(403);
            return res.send({success: false, message: '无权限'});
        }
        if (!example) {
            res.status(422);
            return res.send({ success: false, message: '此话题不存在或已被删除。' });
        }
        author.score -= 5;
        author.example_count -= 1;
        author.save();

        example.deleted = true;
        example.save(function (err) {
            if (err) {
                return res.send({ success: false, message: err.message });
            }
            res.send({ success: true, message: '话题已被删除。' });
        });
    });
};

// 设为置顶
exports.top = function (req, res, next) {
    var example_id = req.params.tid;
    var referer  = req.get('referer');

    if (example_id.length !== 24) {
        res.render404('此话题不存在或已被删除。');
        return;
    }
    Example.getExample(example_id, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        example.top = !example.top;
        example.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = example.top ? '此话题已置顶。' : '此话题已取消置顶。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 设为精华
exports.good = function (req, res, next) {
    var exampleId = req.params.tid;
    var referer = req.get('referer');

    Example.getExample(exampleId, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        example.good = !example.good;
        example.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = example.good ? '此话题已加精。' : '此话题已取消加精。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 锁定主题，不可再回复
exports.lock = function (req, res, next) {
    var exampleId = req.params.tid;
    var referer = req.get('referer');
    Example.getExample(exampleId, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        example.lock = !example.lock;
        example.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = example.lock ? '此话题已锁定。' : '此话题已取消锁定。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 收藏主题
exports.collect = function (req, res, next) {
    var example_id = req.body.example_id;

    Example.getExample(example_id, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.json({status: 'failed'});
        }

        ExampleCollect.getExampleCollect(req.session.user._id, example._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                res.json({status: 'failed'});
                return;
            }

            ExampleCollect.newAndSave(req.session.user._id, example._id, function (err) {
                if (err) {
                    return next(err);
                }
                res.json({status: 'success'});
            });
            User.getUserById(req.session.user._id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_example_count += 1;
                user.save();
            });

            req.session.user.collect_example_count += 1;
            example.collect_count += 1;
            example.save();
        });
    });
};

exports.de_collect = function (req, res, next) {
    var example_id = req.body.example_id;
    Example.getExample(example_id, function (err, example) {
        if (err) {
            return next(err);
        }
        if (!example) {
            res.json({status: 'failed'});
        }
        ExampleCollect.remove(req.session.user._id, example._id, function (err, removeResult) {
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
                user.collect_example_count -= 1;
                req.session.user = user;
                user.save();
            });

            example.collect_count -= 1;
            example.save();

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
