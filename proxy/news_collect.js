var NewsCollect = require('../models').NewsCollect;
var _ = require('lodash')

exports.getNewsCollect = function (userId, newsId, callback) {
    NewsCollect.findOne({user_id: userId, news_id: newsId}, callback);
};

exports.getNewsCollectsByUserId = function (userId, opt, callback) {
    var defaultOpt = {sort: '-create_at'};
    opt = _.assign(defaultOpt, opt)
    NewsCollect.find({user_id: userId}, '', opt, callback);
};

exports.newAndSave = function (userId, newsId, callback) {
    var news_collect      = new NewsCollect();
    news_collect.user_id  = userId;
    news_collect.news_id = newsId;
    news_collect.save(callback);
};

exports.remove = function (userId, newsId, callback) {
    NewsCollect.remove({user_id: userId, news_id: newsId}, callback);
};


