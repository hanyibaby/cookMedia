var ExampleCollect = require('../models').ExampleCollect;
var _ = require('lodash')

exports.getExampleCollect = function (userId, exampleId, callback) {
    ExampleCollect.findOne({user_id: userId, example_id: exampleId}, callback);
};

exports.getExampleCollectsByUserId = function (userId, opt, callback) {
    var defaultOpt = {sort: '-create_at'};
    opt = _.assign(defaultOpt, opt)
    ExampleCollect.find({user_id: userId}, '', opt, callback);
};

exports.newAndSave = function (userId, exampleId, callback) {
    var example_collect      = new ExampleCollect();
    example_collect.user_id  = userId;
    example_collect.example_id = exampleId;
    example_collect.save(callback);
};

exports.remove = function (userId, exampleId, callback) {
    ExampleCollect.remove({user_id: userId, example_id: exampleId}, callback);
};

