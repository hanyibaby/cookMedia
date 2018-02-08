var models       = require('../../models');
var NewsModel   = models.News;
var NewsProxy   = require('../../proxy').News;
var NewsCollect = require('../../proxy').NewsCollect;
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
    var newsTab      = req.query.newsTab || 'all';
    var limit    = Number(req.query.limit) || config.list_news_count;
    var mdrender = req.query.mdrender === 'false' ? false : true;

    var query = {};
    if (!newsTab || newsTab === 'all') {
        query.newsTab = {$nin: ['job', 'dev']}
    } else {
        if (newsTab === 'good') {
            query.good = true;
        } else {
            query.newsTab = newsTab;
        }
    }
    query.deleted = false;
    var options = { skip: (page - 1) * limit, limit: limit, sort: '-top -last_reply_at'};

    var ep = new eventproxy();
    ep.fail(next);

    NewsModel.find(query, '', options, ep.done('newss'));

    ep.all('newss', function (newss) {
        newss.forEach(function (news) {
            UserModel.findById(news.author_id, ep.done(function (author) {
                if (mdrender) {
                    news.content = renderHelper.markdown(at.linkUsers(news.content));
                }
                news.author = _.pick(author, ['loginname', 'avatar_url']);
                ep.emit('author');
            }));
        });

        ep.after('author', newss.length, function () {
            newss = newss.map(function (news) {
                return _.pick(news, ['id', 'author_id', 'newsTab', 'content', 'title', 'last_reply_at',
                    'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);
            });

            res.send({success: true, data: newss});
        });
    });
};

exports.index = index;

var show = function (req, res, next) {
    var newsId  = String(req.params.id);

    var mdrender = req.query.mdrender === 'false' ? false : true;
    var ep       = new eventproxy();

    if (!validator.isMongoId(newsId)) {
        res.status(400);
        return res.send({success: false, error_msg: '不是有效的话题id'});
    }

    ep.fail(next);

    NewsProxy.getFullNews(newsId, ep.done(function (msg, news, author, replies) {
        if (!news) {
            res.status(404);
            return res.send({success: false, error_msg: '话题不存在'});
        }
        news = _.pick(news, ['id', 'author_id', 'newsTab', 'content', 'title', 'last_reply_at',
            'good', 'top', 'reply_count', 'visit_count', 'create_at', 'author']);

        if (mdrender) {
            news.content = renderHelper.markdown(at.linkUsers(news.content));
        }
        news.author = _.pick(author, ['loginname', 'avatar_url']);

        news.replies = replies.map(function (reply) {
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

        ep.emit('full_news', news)
    }));


    if (!req.user) {
        ep.emitLater('is_collect', null)
    } else {
        NewsCollect.getNewsCollect(req.user._id, newsId, ep.done('is_collect'))
    }

    ep.all('full_news', 'is_collect', function (full_news, is_collect) {
        full_news.is_collect = !!is_collect;

        res.send({success: true, data: full_news});
    })

};

exports.show = show;

var create = function (req, res, next) {
    var title   = validator.trim(req.body.title || '');
    var newsTab     = validator.trim(req.body.newsTab || '');
    var content = validator.trim(req.body.content || '');

    // 得到所有的 newsTab, e.g. ['ask', 'share', ..]
    var allTabs = config.newsTabs.map(function (tPair) {
        return tPair[0];
    });

    // 验证
    var editError;
    if (title === '') {
        editError = '标题不能为空';
    } else if (title.length < 5 || title.length > 100) {
        editError = '标题字数太多或太少';
    } else if (!newsTab || !_.includes(allTabs, newsTab)) {
        editError = '必须选择一个版块';
    } else if (content === '') {
        editError = '内容不可为空';
    }
    // END 验证

    if (editError) {
        res.status(400);
        return res.send({success: false, error_msg: editError});
    }

    NewsProxy.newAndSave(title, content, newsTab, req.user.id, function (err, news) {
        if (err) {
            return next(err);
        }

        var proxy = new eventproxy();
        proxy.fail(next);

        proxy.all('score_saved', function () {
            res.send({
                success: true,
                news_id: news.id
            });
        });
        UserProxy.getUserById(req.user.id, proxy.done(function (user) {
            user.score += 5;
            user.news_count += 1;
            user.save();
            req.user = user;
            proxy.emit('score_saved');
        }));

        //发送at消息
        at.sendMessageToMentionUsers(content, news.id, req.user.id);
    });
};

exports.create = create;

exports.update = function (req, res, next) {
    var news_id = _.trim(req.body.news_id);
    var title    = _.trim(req.body.title);
    var newsTab      = _.trim(req.body.newsTab);
    var content  = _.trim(req.body.content);

    // 得到所有的 newsTab, e.g. ['ask', 'share', ..]
    var allTabs = config.newsTabs.map(function (tPair) {
        return tPair[0];
    });

    NewsProxy.getNewsById(news_id, function (err, news, tags) {
        if (!news) {
            res.status(400);
            return res.send({success: false, error_msg: '此话题不存在或已被删除。'});
        }

        if (news.author_id.equals(req.user._id) || req.user.is_admin) {
            // 验证
            var editError;
            if (title === '') {
                editError = '标题不能是空的。';
            } else if (title.length < 5 || title.length > 100) {
                editError = '标题字数太多或太少。';
            } else if (!newsTab || !_.includes(allTabs, newsTab)) {
                editError = '必须选择一个版块。';
            }
            // END 验证

            if (editError) {
                return res.send({success: false, error_msg: editError});
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
                at.sendMessageToMentionUsers(content, news._id, req.user._id);

                res.send({
                    success: true,
                    news_id: news.id
                });
            });
        } else {
            res.status(403)
            return res.send({success: false, error_msg: '对不起，你不能编辑此话题。'});
        }
    });
};

