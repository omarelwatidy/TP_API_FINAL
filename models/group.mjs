import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  icon: { type: String, trim: true, maxlength: 500, match: [/^https?:\/\/\S+$/, 'URL invalide'] },
  coverPhoto: { type: String, trim: true, maxlength: 500, match: [/^https?:\/\/\S+$/, 'URL invalide'] },
  type: { type: String, enum: ['public', 'private', 'secret'], default: 'public' },
  allowMembersToPost: { type: Boolean, default: true },
  allowMembersToCreateEvents: { type: Boolean, default: false },
  admins: [{ type: ObjectId, ref: 'User' }], // au moins 1
  members: [{ type: ObjectId, ref: 'User' }] // au moins 1
}, {
  collection: 'groups',
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
