import user from './user.mjs';
import event from './event.mjs';
import group from './group.mjs';
import thread from './thread.mjs';
import message from './message.mjs';
import album from './album.mjs';
import photo from './photo.mjs';
import poll from './poll.mjs';
import pollAnswer from './pollAnswer.mjs';
import ticketType from './ticketType.mjs';
import ticket from './ticket.mjs';
import shoppingItem from './shoppingItem.mjs';

// On enregistre tous les modèles une seule fois sur la connexion MongoDB
export default (connect) => ({
  User: connect.model('User', user),
  Event: connect.model('Event', event),
  Group: connect.model('Group', group),
  Thread: connect.model('Thread', thread),
  Message: connect.model('Message', message),
  Album: connect.model('Album', album),
  Photo: connect.model('Photo', photo),
  Poll: connect.model('Poll', poll),
  PollAnswer: connect.model('PollAnswer', pollAnswer),
  TicketType: connect.model('TicketType', ticketType),
  Ticket: connect.model('Ticket', ticket),
  ShoppingItem: connect.model('ShoppingItem', shoppingItem)
});
