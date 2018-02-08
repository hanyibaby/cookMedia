/**
 * Created by 仙客来 on 2018/1/27.
 */
var User         = require('../proxy').User;
var CUIT        = require('../proxy').CUIT;
var config       = require('../config');
var eventproxy   = require('eventproxy');
var cache        = require('../common/cache');
var xmlbuilder   = require('xmlbuilder');
var renderHelper = require('../common/render_helper');
var _            = require('lodash');

exports.index = function (req, res, next) {
    var page = parseInt(req.query.page, 10) || 1;
    page = page > 0 ? page : 1;
    var cuitTab = req.query.cuitTab || 'all';

    var proxy = new eventproxy();
    proxy.fail(next);

    // 取主题
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

    var limit = config.list_cuit_count;
    var options = { skip: (page - 1) * limit, limit: limit, sort: '-top -last_reply_at'};

    CUIT.getCUITsByQuery(query, options, proxy.done('cuits', function (cuits) {
        return cuits;
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
    cache.get('no_reply_cuits', proxy.done(function (no_reply_cuits) {
        if (no_reply_cuits) {
            proxy.emit('no_reply_cuits', no_reply_cuits);
        } else {
            CUIT.getCUITsByQuery(
                { reply_count: 0, cuitTab: {$nin: ['job', 'dev']}},
                { limit: 5, sort: '-create_at'},
                proxy.done('no_reply_cuits', function (no_reply_cuits) {
                    cache.set('no_reply_cuits', no_reply_cuits, 60 * 1);
                    return no_reply_cuits;
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
            CUIT.getCountByQuery(query, proxy.done(function (all_cuits_count) {
                var pages = Math.ceil(all_cuits_count / limit);
                cache.set(pagesCacheKey, pages, 60 * 1);
                proxy.emit('pages', pages);
            }));
        }
    }));
    // END 取分页数据

    var cuitTabName = renderHelper.cuitTabName(cuitTab);
    proxy.all('cuits', 'tops', 'no_reply_cuits', 'pages',
        function (cuits, tops, no_reply_cuits, pages) {
            res.render('cuit', {
                cuits: cuits,
                current_page: page,
                list_cuit_count: limit,
                tops: tops,
                no_reply_cuits: no_reply_cuits,
                pages: pages,
                cuitTabs: config.CUITTabs,
                cuitTab: cuitTab,
                pageTitle: cuitTabName && (cuitTabName + '版块'),
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
            CUIT.getLimit5w(function (err, cuits) {
                if (err) {
                    return next(err);
                }
                cuits.forEach(function (cuit) {
                    urlset.ele('url').ele('loc', 'http://cnodejs.org/cuit/' + cuit._id);
                });

                var sitemapData = urlset.end();
                // 缓存一天
                cache.set('sitemap', sitemapData, 3600 * 24);
                ep.emit('sitemap', sitemapData);
            });
        }
    }));
};


