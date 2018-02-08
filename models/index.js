var mongoose = require('mongoose');
var config   = require('../config');
var logger = require('../common/logger')

mongoose.connect(config.db, {
  server: {poolSize: 20}
}, function (err) {
  if (err) {
    logger.error('connect to %s error: ', config.db, err.message);
    process.exit(1);
  }
});

// models
require('./user');
require('./topic');
require('./news');
require('./cuit');
require('./example');
require('./reply');
require('./topic_collect');
require('./news_collect');
require('./cuit_collect');
require('./example_collect');

require('./message');

exports.User         = mongoose.model('User');
exports.Topic        = mongoose.model('Topic');
exports.News         =mongoose.model('News');
exports.CUIT         =mongoose.model('CUIT');
exports.Example         =mongoose.model('Example');
exports.Reply        = mongoose.model('Reply');
exports.TopicCollect = mongoose.model('TopicCollect');
exports.NewsCollect = mongoose.model('NewsCollect');
exports.CUITCollect = mongoose.model('CUITCollect');
exports.ExampleCollect = mongoose.model('ExampleCollect');
exports.Message      = mongoose.model('Message');
