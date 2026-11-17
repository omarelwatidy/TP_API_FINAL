export const withJson = (schema) => schema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    const out = ret;
    if (out._id) {
      out.id = String(out._id);
      delete out._id;
    }
    delete out.password;
    delete out.nameKey;
    return out;
  }
});
