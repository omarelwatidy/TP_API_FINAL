import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const OptionSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 200 }
}).set('toJSON', {
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    return result;
  }
});

const QuestionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 300 },
  options: {
    type: [OptionSchema],
    validate: { validator: (v) => v.length >= 2, message: 'Une question a au moins 2 réponses possibles' }
  }
}).set('toJSON', {
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    return result;
  }
});

const Schema = new mongoose.Schema({
  event: { type: ObjectId, ref: 'Event', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  createdBy: { type: ObjectId, ref: 'User', required: true }, // un organisateur
  questions: {
    type: [QuestionSchema],
    validate: { validator: (v) => v.length >= 1, message: 'Un sondage a au moins 1 question' }
  }
}, {
  collection: 'polls',
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
