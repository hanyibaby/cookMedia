/**
 * Created by 仙客来 on 2018/1/27.
 */
var mongoose  = require('mongoose');
var BaseModel = require("./base_model");
var Schema    = mongoose.Schema;
var ObjectId  = Schema.ObjectId;

var CUITCollectSchema = new Schema({
    user_id: { type: ObjectId },
    cuit_id: { type: ObjectId },
    create_at: { type: Date, default: Date.now }
});

CUITCollectSchema.plugin(BaseModel);
CUITCollectSchema.index({user_id: 1, cuit_id: 1}, {unique: true});

mongoose.model('CUITCollect', CUITCollectSchema);