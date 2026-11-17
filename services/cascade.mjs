export const deleteThreadsWhere = async ({ Thread, Message }, filter) => {
  const ids = await Thread.find(filter).distinct('_id');
  await Message.deleteMany({ thread: { $in: ids } });
  await Thread.deleteMany({ _id: { $in: ids } });
};

export const deleteEventContent = async (models, eventId) => {
  const {
    Album, Photo, Poll, PollAnswer, TicketType, Ticket, ShoppingItem
  } = models;

  await deleteThreadsWhere(models, { event: eventId });

  const albums = await Album.find({ event: eventId }).distinct('_id');
  await Photo.deleteMany({ album: { $in: albums } });
  await Album.deleteMany({ event: eventId });

  const polls = await Poll.find({ event: eventId }).distinct('_id');
  await PollAnswer.deleteMany({ poll: { $in: polls } });
  await Poll.deleteMany({ event: eventId });

  await Promise.all([
    TicketType.deleteMany({ event: eventId }),
    Ticket.deleteMany({ event: eventId }),
    ShoppingItem.deleteMany({ event: eventId })
  ]);
};
