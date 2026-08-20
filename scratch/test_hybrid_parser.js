function parseInterviewScheduleLocal(userMessage) {
  if (!userMessage) return null;
  const text = String(userMessage).toLowerCase().trim();

  // Basic check: must have time or day indicator
  const hasTimeIndicator = /(?:\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje|o'clock)?\b|\btomorrow\b|\bkal\b|\baaj\b|\btoday\b|\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|\bsaturday\b)/i.test(text);
  if (!hasTimeIndicator) return null;

  const now = new Date();
  // IST offset: UTC+5:30
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);

  let targetDate = new Date(istNow);
  let dayOffset = 0;

  if (text.includes('tomorrow') || text.includes('kal')) {
    dayOffset = 1;
  } else if (text.includes('day after tomorrow') || text.includes('parso') || text.includes('parson')) {
    dayOffset = 2;
  } else if (text.includes('today') || text.includes('aaj')) {
    dayOffset = 0;
  } else {
    // Check specific days: monday, tuesday, etc.
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = istNow.getUTCDay();
    for (let i = 0; i < days.length; i++) {
      if (text.includes(days[i])) {
        let diff = i - currentDay;
        if (diff <= 0) diff += 7; // next occurrence
        dayOffset = diff;
        break;
      }
    }
  }

  targetDate.setUTCDate(targetDate.getUTCDate() + dayOffset);

  // Extract hour & minute
  let hour = 11; // default to 11 AM
  let minute = 0;

  // Patterns like "3:30 pm", "3 pm", "14:00", "2 baje", "11 am"
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?/i);
  if (timeMatch) {
    let rawHour = parseInt(timeMatch[1], 10);
    const rawMin = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const modifier = timeMatch[3] ? timeMatch[3].toLowerCase() : '';

    if (rawHour >= 1 && rawHour <= 12) {
      if (modifier === 'pm') {
        if (rawHour !== 12) rawHour += 12;
      } else if (modifier === 'am') {
        if (rawHour === 12) rawHour = 0;
      } else if (modifier === 'baje' || !modifier) {
        // In office context: 1, 2, 3, 4, 5, 6 are PM (13:00 to 18:00); 10, 11, 12 are AM/noon
        if (rawHour >= 1 && rawHour <= 6) {
          rawHour += 12;
        }
      }
    }

    // Check office hours 10 AM to 6 PM (10 to 18)
    if (rawHour >= 10 && rawHour <= 18) {
      hour = rawHour;
      minute = rawMin;
    }
  }

  targetDate.setUTCHours(hour, minute, 0, 0);

  // Format ISO with +05:30
  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getUTCDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const min = String(minute).padStart(2, '0');

  const isoStr = `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`;

  return {
    isScheduling: true,
    proposedDateTimeIso: isoStr,
    readableFormattedTime: `${dd}/${mm}/${yyyy} at ${hour > 12 ? hour - 12 : hour}:${min} ${hour >= 12 ? 'PM' : 'AM'}`
  };
}

// Test cases
console.log('1. "I can come tomorrow at 3 PM":', parseInterviewScheduleLocal('I can come tomorrow at 3 PM'));
console.log('2. "Kal dopahar 2 baje aa sakta hu":', parseInterviewScheduleLocal('Kal dopahar 2 baje aa sakta hu'));
console.log('3. "Monday 11:30 AM":', parseInterviewScheduleLocal('Monday 11:30 AM'));
console.log('4. "What is the job salary?":', parseInterviewScheduleLocal('What is the job salary?'));
