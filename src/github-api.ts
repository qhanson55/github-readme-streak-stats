import type { StreakCardData } from "./cardGenerator.ts";

const GITHUB_GRAPHQL_API = "https://api.github.com/graphql";

interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
}

interface GraphQLYearData {
  user?: {
    createdAt: string;
    contributionsCollection: {
      contributionYears: number[];
    };
  };
}

interface GraphQLCalendarData {
    user?: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: {
            contributionDays: {
              contributionCount: number;
              date: string;
            }[];
          }[];
        };
      };
    };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * Fetch GitHub streak data for a user
 */
async function fetchGraphQL<T>(token: string, query: string, variables: any): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;
  
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  if (!json.data) {
    throw new Error("No data returned from GitHub API");
  }

  return json.data;
}

/**
 * Fetch GitHub streak data for a user
 */
export async function fetchGitHubData(
  username: string,
  token: string,
  useWeeks: boolean
): Promise<StreakCardData> {
  const yearQuery = `
    query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  const yearData = await fetchGraphQL<GraphQLYearData>(token, yearQuery, { login: username });
  
  const user = yearData?.user;
  if (!user) {
    throw new Error(`User ${username} not found`);
  }

  const contributionYears: number[] = user.contributionsCollection.contributionYears;
  const createdAt: string = user.createdAt;


  const calendarQuery = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
  `;

  // Create an array yearly calendar results
  const yearlyResults = await Promise.all(contributionYears.map((year) => {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    return fetchGraphQL<GraphQLCalendarData>(token, calendarQuery, { login: username, from, to });
  }));

  // Create boundries
  const todayDate = new Date();
  const currentYear = todayDate.getUTCFullYear();
  const today = todayDate.toISOString().split('T')[0]!;
  
  const tomorrowDate = new Date(todayDate);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toISOString().split('T')[0]!

  // Aggregate all day contributions from all year results
  let days: { contributionCount: number; date: string }[] = [];
  let totalContributions = 0;

  for (const [i, year] of yearlyResults.entries()) {
    if (!year.user) {
      throw new Error(`User ${username} not found`);
    }

    const yearNum = contributionYears[i];
    const calendar = year.user.contributionsCollection.contributionCalendar;
    totalContributions += calendar.totalContributions;
    
    let daysInYear = calendar.weeks.flatMap((w: any) => w.contributionDays);

    // Filter out future dates
    if (yearNum === currentYear) {
      daysInYear = daysInYear.filter((day) => {
        return day.date <= today || (day.date === tomorrow && day.contributionCount > 0);
      });
    }

    days.push(...daysInYear);
  }

  // Sort days by date
  days.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Process Contributions & Streaks
  const fallbackDate = days[days.length - 1]?.date || today;

  // Calculate streaks
  let currentStreak = 0;
  let longestStreak = 0;
  let currentStreakStart = "";
  let currentStreakEnd = "";
  let longestStreakStart = "";
  let longestStreakEnd = "";

  if (days.length === 0) {
    return {
      username,
      totalContributions: 0,
      currentStreak,
      longestStreak,
      streakStartDate: new Date().toISOString(),
      streakEndDate: new Date().toISOString(),
      longestStreakStartDate: new Date().toISOString(),
      longestStreakEndDate: new Date().toISOString(),
      firstContributionDate: createdAt,
    };
  }

  if (useWeeks) {
    // Gets previous sunday as a way to track weeks for each day.
    const getPreviousSunday = (dateString: string): string => {
      const date = new Date(dateString);
      const dayOfWeek = date.getUTCDay();
      date.setUTCDate(date.getUTCDate() - dayOfWeek);
      return date.toISOString().split('T')[0]!;
    }

    // Calculate contributions per week
    const weeksMap = new Map<string, number>();
    const thisWeekSunday = getPreviousSunday(today);

    days.forEach(day => {
      const sunday = getPreviousSunday(day.date);
      weeksMap.set(sunday, (weeksMap.get(sunday) || 0) + day.contributionCount);
    });

    // Sort weeks map to ensure order and for iterating
    const sortedWeeks = Array.from(weeksMap.keys()).sort();
    let tempWS = 0, tempStart = "";

    // Calculate longest streak from weekly contritbutions
    sortedWeeks.forEach((week) => {
      const count = weeksMap.get(week) || 0;
      if (count > 0) {
        if (tempWS === 0) tempStart = week;
        tempWS++;
        if (tempWS > longestStreak) {
          longestStreak = tempWS;
          longestStreakStart = tempStart;
          longestStreakEnd = week;
        }
      } else if (week !== thisWeekSunday) {
        tempWS = 0;
      }
    });

    currentStreak = tempWS;
    currentStreakStart = tempStart || fallbackDate;
    currentStreakEnd = sortedWeeks[sortedWeeks.length - 1] || fallbackDate;
  } else {
    // Calculate current streak (from end backwards)
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const day = days[i];
      if (!day) continue;

      if (day.contributionCount > 0) {
        streak++;
        currentStreakEnd = currentStreakEnd || day.date;
        currentStreakStart = day.date;
      } else {
        // If today is 0, check if streak continues from yesterday
        if (i === days.length - 1) {
          continue;
        }
        break;
      }
    }
    currentStreak = streak;

    // Calculate longest streak with dates
    let tempStreak = 0;
    let tempStreakStart = "";
    for (const [index, day] of days.entries()) {
      if (day.contributionCount > 0) {
        if (tempStreak === 0) {
          tempStreakStart = day.date;
        }
        tempStreak++;
      } else {
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
          longestStreakStart = tempStreakStart;
          longestStreakEnd = days[index - 1]?.date || tempStreakStart;
        }
        tempStreak = 0;
        tempStreakStart = "";
      }
    }
    // Check if current streak is the longest
    if (tempStreak > longestStreak) {
      longestStreak = tempStreak;
      longestStreakStart = tempStreakStart;
      longestStreakEnd = days[days.length - 1]?.date || tempStreakStart;
    }
  }

  return {
    username,
    totalContributions,
    currentStreak,
    longestStreak,
    streakStartDate: currentStreakStart || fallbackDate,
    streakEndDate: currentStreakEnd || fallbackDate,
    longestStreakStartDate: longestStreakStart || fallbackDate,
    longestStreakEndDate: longestStreakEnd || fallbackDate,
    firstContributionDate: createdAt,
  };
}
