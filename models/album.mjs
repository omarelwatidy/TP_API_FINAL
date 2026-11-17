import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  event: { type: ObjectId, ref: 'Event', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: ObjectId, ref: 'User', required: true }
}, {
  collection: 'albums',
  timestamps: true,
  versionKey: false
}).set('toJSON', {
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    return result;
  }
});

export default Schema;
