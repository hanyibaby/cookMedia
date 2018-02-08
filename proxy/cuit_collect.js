/**
 * Created by 仙客来 on 2018/1/27.
 */
var CUITCollect = require('../models').CUITCollect;
var _ = require('lodash')

exports.getCUITCollect = function (userId, cuitId, callback) {
    CUITCollect.findOne({user_id: userId, cuit_id: cuitId}, callback);
};

exports.getCUITCollectsByUserId = function (userId, opt, callback) {
    var defaultOpt = {sort: '-create_at'};
    opt = _.assign(defaultOpt, opt)
    CUITCollect.find({user_id: userId}, '', opt, callback);
};

exports.newAndSave = function (userId, cuitId, callback) {
    var cuit_collect      = new CUITCollect();
    cuit_collect.user_id  = userId;
    cuit_collect.cuit_id = cuitId;
    cuit_collect.save(callback);
};

exports.remove = function (userId, cuitId, callback) {
    CUITCollect.remove({user_id: userId, cuit_id: cuitId}, callback);
};


