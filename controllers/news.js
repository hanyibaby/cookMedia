var validator = require('validator');

var at           = require('../common/at');
var User         = require('../proxy').User;
var News        = require('../proxy').News;
var NewsCollect = require('../proxy').NewsCollect;
var EventProxy   = require('eventproxy');
var tools        = require('../common/tools');
var store        = require('../common/store');
var config       = require('../config');
var _            = require('lodash');
var cache        = require('../common/cache');
var logger = require('../common/logger')

/**
 * News page
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

    var news_id = req.params.tid;
    var currentUser = req.session.user;

    if (news_id.length !== 24) {
        return res.render404('此话题不存在或已被删除。');
    }
    var events = ['news', 'other_newss', 'no_reply_newss', 'is_collect'];
    var ep = EventProxy.create(events,
        function (news, other_newss, no_reply_newss, is_collect) {
            res.render('news/index', {
                news: news,
                author_other_newss: other_newss,
                no_reply_newss: no_reply_newss,
                is_uped: isUped,
                is_collect: is_collect,
            });
        });

    ep.fail(next);

    News.getFullNews(news_id, ep.done(function (message, news, author, replies) {
        if (message) {
            logger.error('getFullNews error news_id: ' + news_id)
            return res.renderError(message);
        }

        news.visit_count += 1;
        news.save();

        news.author  = author;
        news.replies = replies;

        // 点赞数排名第三的回答，它的点赞数就是阈值
        news.reply_up_threshold = (function () {
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

        ep.emit('news', news);

        // get other_newss
        var options = { limit: 5, sort: '-last_reply_at'};
        var query = { author_id: news.author_id, _id: { '$nin': [ news._id ] } };
        News.getNewssByQuery(query, options, ep.done('other_newss'));

        // get no_reply_newss
        cache.get('no_reply_newss', ep.done(function (no_reply_newss) {
            if (no_reply_newss) {
                ep.emit('no_reply_newss', no_reply_newss);
            } else {
                News.getNewssByQuery(
                    { reply_count: 0, newsTab: {$nin: ['job', 'dev']}},
                    { limit: 5, sort: '-create_at'},
                    ep.done('no_reply_newss', function (no_reply_newss) {
                        cache.set('no_reply_newss', no_reply_newss, 60 * 1);
                        return no_reply_newss;
                    }));
            }
        }));
    }));

    if (!currentUser) {
        ep.emit('is_collect', null);
    } else {
        NewsCollect.getNewsCollect(currentUser._id, news_id, ep.done('is_collect'))
    }
};

exports.create = function (req, res, next) {
    res.render('news/edit', {
        newsTabs: config.newsTabs
    });
};


exports.put = function (req, res, next) {
    var title   = validator.trim(req.body.title);
    var newsTab     = validator.trim(req.body.newsTab);
    var content = validator.trim(req.body.t_content);

    // 得到所有的 newsTab, e.g. ['ask', 'share', ..]
    var allTabs = config.newsTabs.map(function (tPair) {
        return tPair[0];
    });

    // 验证
    var editError;
    if (title === '') {
        editError = '标题不能是空的。';
    } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少。';
    } else if (!newsTab || allTabs.indexOf(newsTab) === -1) {
        editError = '必须选择一个版块。';
    } else if (content === '') {
        editError = '内容不可为空';
    }
    // END 验证

    if (editError) {
        res.status(422);
        return res.render('news/edit', {
            edit_error: editError,
            title: title,
            content: content,
            newsTabs: config.newsTabs
        });
    }

    News.newAndSave(title, content, newsTab, req.session.user._id, function (err, news) {
        if (err) {
            return next(err);
        }

        var proxy = new EventProxy();

        proxy.all('score_saved', function () {
            res.redirect('/news/' + news._id);
        });
        proxy.fail(next);
        User.getUserById(req.session.user._id, proxy.done(function (user) {
            user.score += 5;
            user.news_count += 1;
            user.save();
            req.session.user = user;
            proxy.emit('score_saved');
        }));

        //发送at消息
        at.sendMessageToMentionUsers(content, news._id, req.session.user._id);
    });
};

exports.showEdit = function (req, res, next) {
    var news_id = req.params.tid;

    News.getNewsById(news_id, function (err, news, tags) {
        if (!news) {
            res.render404('此话题不存在或已被删除。');
            return;
        }

        if (String(news.author_id) === String(req.session.user._id) || req.session.user.is_admin) {
            res.render('news/edit', {
                action: 'edit',
                news_id: news._id,
                title: news.title,
                content: news.content,
                newsTab: news.newsTab,
                newsTabs: config.newsTabs
            });
        } else {
            res.renderError('对不起，你不能编辑此话题。', 403);
        }
    });
};

exports.update = function (req, res, next) {
    var news_id = req.params.tid;
    var title    = req.body.title;
    var newsTab      = req.body.newsTab;
    var content  = req.body.t_content;

    News.getNewsById(news_id, function (err, news, tags) {
        if (!news) {
            res.render404('此话题不存在或已被删除。');
            return;
        }

        if (news.author_id.equals(req.session.user._id) || req.session.user.is_admin) {
            title   = validator.trim(title);
            newsTab     = validator.trim(newsTab);
            content = validator.trim(content);

            // 验证
            var editError;
            if (title === '') {
                editError = '标题不能是空的。';
            } else if (title.length < 5 || title.length > 100) {
                editError = '标题字数太多或太少。';
            } else if (!newsTab) {
                editError = '必须选择一个版块。';
            }
            // END 验证

            if (editError) {
                return res.render('news/edit', {
                    action: 'edit',
                    edit_error: editError,
                    news_id: news._id,
                    content: content,
                    newsTabs: config.newsTabs
                });
            }

            //保存话题
            news.title     = title;
            news.content   = content;
            news.newsTab       = newsTab;
            news.update_at = new Date();

            news.save(function (err) {
                if (err) {
                    return next(err);
                }
                //发送at消息
                at.sendMessageToMentionUsers(content, news._id, req.session.user._id);

                res.redirect('/news/' + news._id);

            });
        } else {
            res.renderError('对不起，你不能编辑此话题。', 403);
        }
    });
};

exports.delete = function (req, res, next) {
    //删除话题, 话题作者news_count减1
    //删除回复，回复作者reply_count减1
    //删除news_collect，用户collect_news_count减1

    var news_id = req.params.tid;

    News.getFullNews(news_id, function (err, err_msg, news, author, replies) {
        if (err) {
            return res.send({ success: false, message: err.message });
        }
        if (!req.session.user.is_admin && !(news.author_id.equals(req.session.user._id))) {
            res.status(403);
            return res.send({success: false, message: '无权限'});
        }
        if (!news) {
            res.status(422);
            return res.send({ success: false, message: '此话题不存在或已被删除。' });
        }
        author.score -= 5;
        author.news_count -= 1;
        author.save();

        news.deleted = true;
        news.save(function (err) {
            if (err) {
                return res.send({ success: false, message: err.message });
            }
            res.send({ success: true, message: '话题已被删除。' });
        });
    });
};

// 设为置顶
exports.top = function (req, res, next) {
    var news_id = req.params.tid;
    var referer  = req.get('referer');

    if (news_id.length !== 24) {
        res.render404('此话题不存在或已被删除。');
        return;
    }
    News.getNews(news_id, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        news.top = !news.top;
        news.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = news.top ? '此话题已置顶。' : '此话题已取消置顶。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 设为精华
exports.good = function (req, res, next) {
    var newsId = req.params.tid;
    var referer = req.get('referer');

    News.getNews(newsId, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        news.good = !news.good;
        news.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = news.good ? '此话题已加精。' : '此话题已取消加精。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 锁定主题，不可再回复
exports.lock = function (req, res, next) {
    var newsId = req.params.tid;
    var referer = req.get('referer');
    News.getNews(newsId, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.render404('此话题不存在或已被删除。');
            return;
        }
        news.lock = !news.lock;
        news.save(function (err) {
            if (err) {
                return next(err);
            }
            var msg = news.lock ? '此话题已锁定。' : '此话题已取消锁定。';
            res.render('notify/notify', {success: msg, referer: referer});
        });
    });
};

// 收藏主题
exports.collect = function (req, res, next) {
    var news_id = req.body.news_id;

    News.getNews(news_id, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.json({status: 'failed'});
        }

        NewsCollect.getNewsCollect(req.session.user._id, news._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                res.json({status: 'failed'});
                return;
            }

            NewsCollect.newAndSave(req.session.user._id, news._id, function (err) {
                if (err) {
                    return next(err);
                }
                res.json({status: 'success'});
            });
            User.getUserById(req.session.user._id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.collect_news_count += 1;
                user.save();
            });

            req.session.user.collect_news_count += 1;
            news.collect_count += 1;
            news.save();
        });
    });
};

exports.de_collect = function (req, res, next) {
    var news_id = req.body.news_id;
    News.getNews(news_id, function (err, news) {
        if (err) {
            return next(err);
        }
        if (!news) {
            res.json({status: 'failed'});
        }
        NewsCollect.remove(req.session.user._id, news._id, function (err, removeResult) {
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
                user.collect_news_count -= 1;
                req.session.user = user;
                user.save();
            });

            news.collect_count -= 1;
            news.save();

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
