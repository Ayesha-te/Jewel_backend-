export function applyCleanJson(schema) {
  schema.set("toJSON", {
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      return ret;
    },
  });
}
