var multiline = require('multiline');
// static page
// 在线游戏
exports.onlineGame = function (req, res, next) {
  res.render('static/onlineGame', {
    pageTitle: '在线游戏'
  });
};