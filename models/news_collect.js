var mongoose  = require('mongoose');
var BaseModel = require("./base_model");
var Schema    = mongoose.Schema;
var ObjectId  = Schema.ObjectId;

var NewsCollectSchema = new Schema({
    user_id: { type: ObjectId },
    news_id: { type: ObjectId },
    create_at: { type: Date, default: Date.now }
});

NewsCollectSchema.plugin(BaseModel);
NewsCollectSchema.index({user_id: 1, news_id: 1}, {unique: true});

mongoose.model('NewsCollect', NewsCollectSchema);