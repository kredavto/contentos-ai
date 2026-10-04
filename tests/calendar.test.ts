import {describe,it,expect} from 'vitest';
import {calendarInstant,calendarCreateSchema,calendarWindowSchema,localMinute} from '../packages/types/src/calendar';
describe('calendar wall time boundaries',()=>{
  it('persists UTC independently of the server time zone',()=>{expect(calendarInstant('2026-10-04T12:30','Europe/Moscow').toISOString()).toBe('2026-10-04T09:30:00.000Z');expect(calendarInstant('2026-10-04T12:30','Asia/Kathmandu').toISOString()).toBe('2026-10-04T06:45:00.000Z');});
  it('rejects nonexistent spring times and requires a choice for repeated fall times',()=>{
    expect(()=>calendarInstant('2026-03-08T02:30','America/New_York')).toThrow('INVALID_INPUT');
    expect(()=>calendarInstant('2026-11-01T01:30','America/New_York')).toThrow('INVALID_INPUT');
    const early=calendarInstant('2026-11-01T01:30','America/New_York','EARLIER'),late=calendarInstant('2026-11-01T01:30','America/New_York','LATER');
    expect(late.getTime()-early.getTime()).toBe(3600000);expect(localMinute(early,'America/New_York')).toBe(localMinute(late,'America/New_York'));
    expect(calendarInstant('2026-04-05T01:45','Australia/Lord_Howe','LATER').getTime()-calendarInstant('2026-04-05T01:45','Australia/Lord_Howe','EARLIER').getTime()).toBe(1800000);
  });
  it('rejects invalid dates, unknown zones and unbounded queries',()=>{
    for(const [date,zone] of [['2026-02-30T12:00','UTC'],['2026-10-04T25:00','UTC'],['2026-10-04T12:00','Made/Up']])expect(()=>calendarInstant(date!,zone!)).toThrow('INVALID_INPUT');
    expect(calendarWindowSchema.safeParse({from:'2026-01-01T00:00:00Z',to:'2026-12-31T00:00:00Z'}).success).toBe(false);
    expect(calendarCreateSchema.safeParse({title:'A',type:'POST',platform:'TELEGRAM',localDateTime:'2026-10-04T12:00',timeZone:'UTC',publishingMode:'AUTOPILOT',idempotencyKey:'123'}).success).toBe(false);
  });
});
