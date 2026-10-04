// Test-only loopback SMTP sink. Never imported by production applications.
import { createServer } from 'node:http';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
if (process.env.NODE_ENV === 'production') throw new Error('Test mail server is forbidden in production');
const messages: Array<{ to: string[]; text: string }> = [];
const smtp = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'], logger: false,
  onData(stream, _session, callback) {
    simpleParser(stream).then(mail => {
      const recipients = Array.isArray(mail.to) ? mail.to : mail.to ? [mail.to] : [];
      messages.push({ to: recipients.flatMap(item => item.value.map(address => address.address ?? '')), text: mail.text ?? '' });
      if (messages.length > 100) messages.shift();
      callback();
    }).catch(callback);
  },
});
smtp.listen(1026, '127.0.0.1');
const http = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/health') { response.end('{"ok":true}'); return; }
  const recipient = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('recipient');
  response.end(JSON.stringify(messages.filter(message => message.to.includes(recipient ?? ''))));
});
http.listen(8026, '127.0.0.1');
function close() { smtp.close(); http.close(); }
process.on('SIGTERM', close); process.on('SIGINT', close);
