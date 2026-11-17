import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  startDate: { type: Date, required: true },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator(value) {
        return !this.startDate || value > this.startDate;
      },
      message: 'endDate doit être après startDate'
    }
  },
  location: { type: String, required: true, trim: true, maxlength: 300 },
  coverPhoto: { type: String, trim: true, maxlength: 500, match: [/^https?:\/\/\S+$/, 'URL invalide'] },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  organizers: [{ type: ObjectId, ref: 'User' }], // au moins 1
  members: [{ type: ObjectId, ref: 'User' }], // les participants
  group: { type: ObjectId, ref: 'Group' },
  createdBy: { type: ObjectId, ref: 'User' },
  shoppingListEnabled: { type: Boolean, default: false },
  ticketingEnabled: {
    type: Boolean,
    default: false,
    validate: {
      validator(value) {
        return !value || this.visibility === 'public';
      },
      message: 'La billetterie est réservée aux événements publics'
    }
  }
}, {
  collection: 'events',
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
