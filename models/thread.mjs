import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  group: { type: ObjectId, ref: 'Group' },
  event: { type: ObjectId, ref: 'Event' },
  createdBy: { type: ObjectId, ref: 'User' }
}, {
  collection: 'threads',
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

// Un fil est lié à un groupe OU à un événement : pas les deux, pas aucun
Schema.pre('validate', function checkParent() {
  if (Boolean(this.group) === Boolean(this.event)) {
    this.invalidate('group', 'Un fil est lié à un groupe OU à un événement (pas les deux)');
  }
});

// Un seul fil par groupe et un seul par événement
Schema.index({ group: 1 }, { unique: true, partialFilterExpression: { group: { $type: 'objectId' } } });
Schema.index({ event: 1 }, { unique: true, partialFilterExpression: { event: { $type: 'objectId' } } });

export default Schema;
