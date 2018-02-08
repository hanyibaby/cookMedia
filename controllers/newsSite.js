var User         = require('../proxy').User;
var News        = require('../proxy').News;
var config       = require('../config');
var eventproxy   = require('eventproxy');
var cache        = require('../common/cache');
var xmlbuilder   = require('xmlbuilder');
var renderHelper = require('../common/render_helper');
var _            = require('lodash');

exports.index = function (req, res, next) {
    var page = parseInt(req.query.page, 10) || 1;
    page = page > 0 ? page : 1;
    var newsTab = req.query.newsTab || 'all';

    var proxy = new eventproxy();
    proxy.fail(next);

    // 取主题
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

    var limit = config.list_news_count;
    var options = { skip: (page - 1) * limit, limit: limit, sort: '-top -last_reply_at'};

    News.getNewssByQuery(query, options, proxy.done('newss', function (newss) {
        return newss;
    }));

    // 取排行榜上的用户
    cache.get('tops', proxy.done(function (tops) {
        if (tops) {
            proxy.emit('tops', tops);
        } else {
            User.getUsersByQuery(
                {is_block: false},
                { limit: 10, sort: '-score'},
                proxy.done('tops', function (tops) {
                    cache.set('tops', tops, 60 * 1);
                    return tops;
                })
            );
        }
    }));
    // END 取排行榜上的用户

    // 取0回复的主题
    cache.get('no_reply_newss', proxy.done(function (no_reply_newss) {
        if (no_reply_newss) {
            proxy.emit('no_reply_newss', no_reply_newss);
        } else {
            News.getNewssByQuery(
                { reply_count: 0, newsTab: {$nin: ['job', 'dev']}},
                { limit: 5, sort: '-create_at'},
                proxy.done('no_reply_newss', function (no_reply_newss) {
                    cache.set('no_reply_newss', no_reply_newss, 60 * 1);
                    return no_reply_newss;
                }));
        }
    }));
    // END 取0回复的主题

    // 取分页数据
    var pagesCacheKey = JSON.stringify(query) + 'pages';
    cache.get(pagesCacheKey, proxy.done(function (pages) {
        if (pages) {
            proxy.emit('pages', pages);
        } else {
            News.getCountByQuery(query, proxy.done(function (all_newss_count) {
                var pages = Math.ceil(all_newss_count / limit);
                cache.set(pagesCacheKey, pages, 60 * 1);
                proxy.emit('pages', pages);
            }));
        }
    }));
    // END 取分页数据

    var newsTabName = renderHelper.newsTabName(newsTab);
    proxy.all('newss', 'tops', 'no_reply_newss', 'pages',
        function (newss, tops, no_reply_newss, pages) {
            res.render('news', {
                newss: newss,
                current_page: page,
                list_news_count: limit,
                tops: tops,
                no_reply_newss: no_reply_newss,
                pages: pages,
                newsTabs: config.newsTabs,
                newsTab: newsTab,
                pageTitle: newsTabName && (newsTabName + '版块'),
            });
        });
};

exports.sitemap = function (req, res, next) {
    var urlset = xmlbuilder.create('urlset',
        {version: '1.0', encoding: 'UTF-8'});
    urlset.att('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9');

    var ep = new eventproxy();
    ep.fail(next);

    ep.all('sitemap', function (sitemap) {
        res.type('xml');
        res.send(sitemap);
    });

    cache.get('sitemap', ep.done(function (sitemapData) {
        if (sitemapData) {
            ep.emit('sitemap', sitemapData);
        } else {
            News.getLimit5w(function (err, newss) {
                if (err) {
                    return next(err);
                }
                newss.forEach(function (news) {
                    urlset.ele('url').ele('loc', 'http://cnodejs.org/news/' + news._id);
                });

                var sitemapData = urlset.end();
                // 缓存一天
                cache.set('sitemap', sitemapData, 3600 * 24);
                ep.emit('sitemap', sitemapData);
            });
        }
    }));
};

exports.appDownload = function (req, res, next) {
    //res.redirect('https://github.com/soliury/noder-react-native/blob/master/README.md')
};
