import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  poll: { type: ObjectId, ref: 'Poll', required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  // une seule réponse choisie par question
  answers: [{
    _id: false,
    question: { type: ObjectId, required: true },
    option: { type: ObjectId, required: true }
  }]
}, {
  collection: 'pollanswers',
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

// Un participant ne répond qu'une fois à un sondage
Schema.index({ poll: 1, user: 1 }, { unique: true });

export default Schema;
