var express = require('express');
var sign = require('./controllers/sign');
var site = require('./controllers/site');
var user = require('./controllers/user');
var message = require('./controllers/message');
///////////hanyi1/15
var newsSite=require('./controllers/newsSite');
var cuitSite=require('./controllers/cuitSite');
var exampleSite=require('./controllers/exampleSite');
///////////hanyi1/15
var topic = require('./controllers/topic');
var news = require('./controllers/news');
var example = require('./controllers/example');
var cuit = require('./controllers/cuit');
var reply = require('./controllers/reply');
var rss = require('./controllers/rss');
var staticController = require('./controllers/static');
var auth = require('./middlewares/auth');
var limit = require('./middlewares/limit');

var search = require('./controllers/search');
var passport = require('passport');
var configMiddleware = require('./middlewares/conf');
var config = require('./config');

var router = express.Router();

// home page
router.get('/', site.index);
router.get('/home/news', newsSite.index);
router.get('/home/cuit', cuitSite.index);
router.get('/home/example', exampleSite.index);
// sitemap
router.get('/sitemap.xml', site.sitemap);
// mobile app download
router.get('/app/download', site.appDownload);

// sign controller
if (config.allow_sign_up) {
  router.get('/signup', sign.showSignup);  // 跳转到注册页面
  router.post('/signup', sign.signup);  // 提交注册信息
}
router.post('/signout', sign.signout);  // 登出
router.get('/signin', sign.showLogin);  // 进入登录页面
router.post('/signin', sign.login);  // 登录校验
router.get('/active_account', sign.activeAccount);  //帐号激活

router.get('/search_pass', sign.showSearchPass);  // 找回密码页面
router.post('/search_pass', sign.updateSearchPass);  // 更新密码
router.get('/reset_pass', sign.resetPass);  // 进入重置密码页面
router.post('/reset_pass', sign.updatePass);  // 更新密码

// user controller
router.get('/user/:name', user.index); // 用户个人主页
router.get('/setting', auth.userRequired, user.showSetting); // 用户个人设置页
router.post('/setting', auth.userRequired, user.setting); // 提交个人信息设置
router.get('/stars', user.listStars); // 显示所有达人列表页
router.get('/users/top100', user.top100);  // 显示积分前一百用户页
router.get('/user/:name/collections', user.listCollectedTopics);  // 用户收藏的所有话题页
router.get('/user/:name/topics', user.listTopics);  // 用户发布的所有话题页

router.get('/user/:name/collections', user.listCollectedNewss);  // 用户收藏的所有新闻页
router.get('/user/:name/newss', user.listNewss);  // 用户发布的所有新闻页

router.get('/user/:name/collections', user.listCollectedCUITs);  // 用户收藏的所有数媒专业内容
 router.get('/user/:name/cuits', user.listCUITs);  // 用户发布的所有新闻页

router.get('/user/:name/collections', user.listCollectedExamples);  // 用户收藏的所有新闻页
router.get('/user/:name/examples', user.listExamples);  // 用户发布的所有新闻页

router.get('/user/:name/replies', user.listReplies);  // 用户参与的所有回复页
router.post('/user/set_star', auth.adminRequired, user.toggleStar); // 把某用户设为达人
router.post('/user/cancel_star', auth.adminRequired, user.toggleStar);  // 取消某用户的达人身份
router.post('/user/:name/block', auth.adminRequired, user.block);  // 禁言某用户
router.post('/user/:name/delete_all', auth.adminRequired, user.deleteAll);  // 删除某用户所有发言

// message controler
router.get('/personal/messages', auth.userRequired, message.index); // 用户个人的所有消息页

////////////////////新增hanyi1月15日
router.get('/home/news',auth.userRequired,news.index);
router.get('/home/cuit',auth.userRequired,cuit.index);
router.get('/home/example',auth.userRequired,example.index);
////////////////////新增hanyi1月15日

// topic

// 新建文章界面
router.get('/topic/create', auth.userRequired, topic.create);

router.get('/topic/:tid', topic.index);  // 显示某个话题
router.post('/topic/:tid/top', auth.adminRequired, topic.top);  // 将某话题置顶
router.post('/topic/:tid/good', auth.adminRequired, topic.good); // 将某话题加精
router.get('/topic/:tid/edit', auth.userRequired, topic.showEdit);  // 编辑某话题
router.post('/topic/:tid/lock', auth.adminRequired, topic.lock); // 锁定主题，不能再回复

router.post('/topic/:tid/delete', auth.userRequired, topic.delete);

// 保存新建的文章
router.post('/topic/create', auth.userRequired, limit.peruserperday('create_topic', config.create_post_per_day, {showJson: false}), topic.put);

router.post('/topic/:tid/edit', auth.userRequired, topic.update);
router.post('/topic/collect', auth.userRequired, topic.collect); // 关注某话题
router.post('/topic/de_collect', auth.userRequired, topic.de_collect); // 取消关注某话题
///////////////////////////////hanyi1/17
//新建新闻界面、主题、资源
router.get('/news/create', auth.userRequired, news.create);
router.get('/news/:tid', news.index);  // 显示某个新闻
router.post('/news/:tid/top', auth.adminRequired, news.top);  // 将某新闻置顶
router.post('/news/:tid/good', auth.adminRequired, news.good); // 将某新闻加精
router.get('/news/:tid/edit', auth.userRequired, news.showEdit);  // 编辑某新闻
router.post('/news/:tid/lock', auth.adminRequired, news.lock); // 锁定新闻，不能再回复
router.post('/news/:tid/delete', auth.userRequired, news.delete);

router.get('/cuit/create', auth.userRequired, cuit.create);
router.get('/cuit/:tid', cuit.index);  // 显示某个新闻
router.post('/cuit/:tid/top', auth.adminRequired, cuit.top);  //
router.post('/cuit/:tid/good', auth.adminRequired, cuit.good); //
router.get('/cuit/:tid/edit', auth.userRequired, cuit.showEdit);  //
router.post('/cuit/:tid/lock', auth.adminRequired, cuit.lock); //
router.post('/cuit/:tid/delete', auth.userRequired, cuit.delete);

router.get('/example/create', auth.userRequired, example.create);
router.get('/example/:tid', example.index);  //
router.post('/example/:tid/top', auth.adminRequired, example.top);  //
router.post('/example/:tid/good', auth.adminRequired, example.good); //
router.get('/example/:tid/edit', auth.userRequired, example.showEdit);  //
router.post('/example/:tid/lock', auth.adminRequired, example.lock); //
router.post('/example/:tid/delete', auth.userRequired, example.delete);

// 保存新建的新闻、主题、资源
router.post('/news/create', auth.userRequired, limit.peruserperday('create_news', config.create_post_per_day, {showJson: false}), news.put);
router.post('/news/:tid/edit', auth.userRequired, news.update);
router.post('/news/collect', auth.userRequired, news.collect); // 关注某新闻
router.post('/news/de_collect', auth.userRequired, news.de_collect); // 取消关注某新闻

router.post('/cuit/create', auth.userRequired, limit.peruserperday('create_cuit', config.create_post_per_day, {showJson: false}), cuit.put);
router.post('/cuit/:tid/edit', auth.userRequired, cuit.update);
router.post('/cuit/collect', auth.userRequired, cuit.collect);
router.post('/cuit/de_collect', auth.userRequired, cuit.de_collect);

router.post('/example/create', auth.userRequired, limit.peruserperday('create_example', config.create_post_per_day, {showJson: false}), example.put);
router.post('/example/:tid/edit', auth.userRequired, example.update);
router.post('/example/collect', auth.userRequired, example.collect); //
router.post('/example/de_collect', auth.userRequired, example.de_collect);
/////////////////////////////////////hanyi1/17
// reply controller
router.post('/:topic_id/reply', auth.userRequired, limit.peruserperday('create_reply', config.create_reply_per_day, {showJson: false}), reply.add); // 提交一级回复
router.post('/:news_id/reply', auth.userRequired, limit.peruserperday('create_reply', config.create_reply_per_day, {showJson: false}), reply.add); // 提交一级回复
router.post('/:cuit_id/reply', auth.userRequired, limit.peruserperday('create_reply', config.create_reply_per_day, {showJson: false}), reply.add); // 提交一级回复
router.post('/:example_id/reply', auth.userRequired, limit.peruserperday('create_reply', config.create_reply_per_day, {showJson: false}), reply.add); // 提交一级回复


router.get('/reply/:reply_id/edit', auth.userRequired, reply.showEdit); // 修改自己的评论页
router.post('/reply/:reply_id/edit', auth.userRequired, reply.update); // 修改某评论
router.post('/reply/:reply_id/delete', auth.userRequired, reply.delete); // 删除某评论
router.post('/reply/:reply_id/up', auth.userRequired, reply.up); // 为评论点赞
router.post('/upload', auth.userRequired, topic.upload); //上传图片
router.post('/upload', auth.userRequired, news.upload); //上传图片
router.post('/upload', auth.userRequired, cuit.upload); //上传图片
router.post('/upload', auth.userRequired, example.upload); //上传图片
// static
router.get('/onlineGame', staticController.onlineGame);
//rss
router.get('/rss', rss.index);
module.exports = router;
