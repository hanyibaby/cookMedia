var _            = require('lodash');
var eventproxy   = require('eventproxy');
var UserProxy    = require('../../proxy').User;
var TopicProxy   = require('../../proxy').Topic;
var ReplyProxy   = require('../../proxy').Reply;
var TopicCollect = require('../../proxy').TopicCollect;
var NewsProxy   = require('../../proxy').News;
var NewsCollect = require('../../proxy').NewsCollect;
var CUITProxy   = require('../../proxy').CUIT;
var CUITCollect = require('../../proxy').CUITCollect;
var ExampleProxy   = require('../../proxy').Example;
var ExampleCollect = require('../../proxy').ExampleCollect;
var show = function (req, res, next) {
  var loginname = req.params.loginname;
  var ep        = new eventproxy();

  ep.fail(next);

  UserProxy.getUserByLoginName(loginname, ep.done(function (user) {
    if (!user) {
      res.status(404);
      return res.send({success: false, error_msg: '用户不存在'});
    }
    var query = {author_id: user._id};
    var opt = {limit: 15, sort: '-create_at'};
    TopicProxy.getTopicsByQuery(query, opt, ep.done('recent_topics'));
    NewsProxy.getNewssByQuery(query, opt, ep.done('recent_newss'));
      CUITProxy.getCUITsByQuery(query, opt, ep.done('recent_cuits'));
      ExampleProxy.getExamplesByQuery(query, opt, ep.done('recent_examples'));
    ReplyProxy.getRepliesByAuthorId(user._id, {limit: 20, sort: '-create_at'},
      ep.done(function (replies) {
        var topic_ids = replies.map(function (reply) {
          return reply.topic_id.toString()
        });
        topic_ids = _.uniq(topic_ids).slice(0, 5); //  只显示最近5条

        var query = {_id: {'$in': topic_ids}};
        var opt = {};
        TopicProxy.getTopicsByQuery(query, opt, ep.done('recent_replies', function (recent_replies) {
          recent_replies = _.sortBy(recent_replies, function (topic) {
            return topic_ids.indexOf(topic._id.toString())
          });
          return recent_replies;
        }));
      }));
  }));
};

exports.show = show;
