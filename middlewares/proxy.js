var urllib  = require('url');
var request = require('request');
var logger = require('../common/logger')
var _ = require('lodash')

exports.proxy = function (req, res, next) {
  var url = decodeURIComponent(req.query.url);
  var hostname = urllib.parse(url).hostname;

  if (ALLOW_HOSTNAME.indexOf(hostname) === -1) {
    return res.send(hostname + ' is not allowed');
  }

  request.get({
      url: url,
      headers: _.omit(req.headers, ['cookie', 'refer']),
    })
    .on('response', function (response) {
      res.set(response.headers);
    })
    .on('error', function (err) {
      logger.error(err);
    })
    .pipe(res);
};
