var User         = require('../proxy').User;
var Example        = require('../proxy').Example;
var config       = require('../config');
var eventproxy   = require('eventproxy');
var cache        = require('../common/cache');
var xmlbuilder   = require('xmlbuilder');
var renderHelper = require('../common/render_helper');
var _            = require('lodash');

exports.index = function (req, res, next) {
    var page = parseInt(req.query.page, 10) || 1;
    page = page > 0 ? page : 1;
    var exampleTab = req.query.exampleTab || 'all';

    var proxy = new eventproxy();
    proxy.fail(next);

    // 取主题
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

    var limit = config.list_example_count;
    var options = { skip: (page - 1) * limit, limit: limit, sort: '-top -last_reply_at'};

    Example.getExamplesByQuery(query, options, proxy.done('examples', function (examples) {
        return examples;
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
    cache.get('no_reply_examples', proxy.done(function (no_reply_examples) {
        if (no_reply_examples) {
            proxy.emit('no_reply_examples', no_reply_examples);
        } else {
            Example.getExamplesByQuery(
                { reply_count: 0, exampleTab: {$nin: ['job', 'dev']}},
                { limit: 5, sort: '-create_at'},
                proxy.done('no_reply_examples', function (no_reply_examples) {
                    cache.set('no_reply_examples', no_reply_examples, 60 * 1);
                    return no_reply_examples;
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
            Example.getCountByQuery(query, proxy.done(function (all_examples_count) {
                var pages = Math.ceil(all_examples_count / limit);
                cache.set(pagesCacheKey, pages, 60 * 1);
                proxy.emit('pages', pages);
            }));
        }
    }));
    // END 取分页数据

    var exampleTabName = renderHelper.exampleTabName(exampleTab);
    proxy.all('examples', 'tops', 'no_reply_examples', 'pages',
        function (examples, tops, no_reply_examples, pages) {
            res.render('example', {
                examples: examples,
                current_page: page,
                list_example_count: limit,
                tops: tops,
                no_reply_examples: no_reply_examples,
                pages: pages,
                exampleTabs: config.exampleTabs,
                exampleTab: exampleTab,
                pageTitle: exampleTabName && (exampleTabName + '版块'),
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
            Example.getLimit5w(function (err, examples) {
                if (err) {
                    return next(err);
                }
                examples.forEach(function (example) {
                    urlset.ele('url').ele('loc', 'http://cnodejs.org/example/' + example._id);
                });

                var sitemapData = urlset.end();
                // 缓存一天
                cache.set('sitemap', sitemapData, 3600 * 24);
                ep.emit('sitemap', sitemapData);
            });
        }
    }));
};

