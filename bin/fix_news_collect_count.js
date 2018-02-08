/**
 * Created by 仙客来 on 2018/1/18.
 */
var NewsCollect = require('../models').NewsCollect;
var UserModel = require('../models').User;
var NewsModel = require('../models').News

// 修复用户的news_collect计数
NewsCollect.aggregate(
    [{
        "$group" :
        {
            _id : {user_id: "$user_id"},
            count : { $sum : 1}
        }
    }], function (err, result) {
        result.forEach(function (row) {
            var userId = row._id.user_id;
            var count = row.count;

            UserModel.findOne({
                _id: userId
            }, function (err, user) {

                if (!user) {
                    return;
                }

                user.collect_news_count = count;
                user.save(function () {
                    console.log(user.loginname, count)
                });
            })
        })
    })

// 修复帖子的news_collect计数
NewsCollect.aggregate(
    [{
        "$group" :
        {
            _id : {news_id: "$news_id"},
            count : { $sum : 1}
        }
    }], function (err, result) {
        result.forEach(function (row) {
            var news_id = row._id.news_id;
            var count = row.count;

            NewsModel.findOne({
                _id: news_id
            }, function (err, news) {

                if (!news) {
                    return;
                }

                news.collect_news_count = count;
                news.save(function () {
                    console.log(news.id, count)
                });
            })
        })
    })
