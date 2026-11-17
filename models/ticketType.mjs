import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  event: { type: ObjectId, ref: 'Event', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 }, // quantité limitée
  sold: { type: Number, default: 0, min: 0 } // billets déjà vendus
}, {
  collection: 'tickettypes',
  timestamps: true,
  versionKey: false
});

// Nombre de billets restants (calculé, pas stocké)
Schema.virtual('remaining').get(function remaining() {
  return this.quantity - this.sold;
});

Schema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    return result;
  }
});

export default Schema;
