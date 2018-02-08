var mongoose  = require('mongoose');
var BaseModel = require("./base_model");
var Schema    = mongoose.Schema;
var ObjectId  = Schema.ObjectId;

var ExampleCollectSchema = new Schema({
    user_id: { type: ObjectId },
    example_id: { type: ObjectId },
    create_at: { type: Date, default: Date.now }
});

ExampleCollectSchema.plugin(BaseModel);
ExampleCollectSchema.index({user_id: 1, example_id: 1}, {unique: true});

mongoose.model('ExampleCollect', ExampleCollectSchema);