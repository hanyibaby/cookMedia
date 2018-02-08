// 一次性脚本
// 修复之前重复编辑帖子会导致重复 @someone 的渲染问题
var TopicModel = require('../models').Topic;
var NewsModel = require('../models').News;

TopicModel.find({content: /\[{2,}@/}).exec(function (err, topics) {
  topics.forEach(function (topic) {
    topic.content = fix(topic.content);
    console.log(topic.id);
    topic.save();
  });
});

NewsModel.find({content: /\[{2,}@/}).exec(function (err, newss) {
  newss.forEach(function (news) {
    news.content = fix(news.content);
    console.log(news.id);
    news.save();
  });
});
function fix(str) {
  str = str.replace(/\[{1,}(\[@\w+)(\]\(.+?\))\2+/, function (match_text, $1, $2) {
    return $1 + $2;
  });
  return str;
}
