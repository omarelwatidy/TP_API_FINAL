import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Un commentaire est rangé dans le message (ou la photo) qu'il commente
export const CommentSchema = new mongoose.Schema({
  author: { type: ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 }
}, { timestamps: true }).set('toJSON', {
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    return result;
  }
});

const Schema = new mongoose.Schema({
  thread: { type: ObjectId, ref: 'Thread', required: true, index: true },
  author: { type: ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  comments: [CommentSchema]
}, {
  collection: 'messages',
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
