import type { StreakCardData } from "./cardGenerator.ts";

const GITHUB_GRAPHQL_API = "https://api.github.com/graphql";

interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
}

interface GraphQLResponse {
  data?: {
    user?: {
      createdAt: string;
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
  };
  errors?: GraphQLError[];
}

/**
 * Fetch GitHub streak data for a user
 */
export async function fetchGitHubData(
  username: string,
  token: string,
  useWeeks: boolean
): Promise<StreakCardData> {
  const query = `
    query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection {
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

  const response = await fetch(GITHUB_GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { login: username },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API failed: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as GraphQLResponse;

  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const user = json.data?.user;
  if (!user) {
    throw new Error(`User ${username} not found`);
  }

  // Process Contributions & Streaks
  const calendar = user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap((w) => w.contributionDays);

  const fallbackDate = days[days.length - 1]?.date || new Date().toISOString();
  const today = new Date().toISOString().split('T')[0]!;

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
      firstContributionDate: user.createdAt,
    };
  }

  // Sort days by date
  days.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
    for (const day of days) {
      if (day.contributionCount > 0) {
        if (tempStreak === 0) {
          tempStreakStart = day.date;
        }
        tempStreak++;
      } else {
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
          longestStreakStart = tempStreakStart;
          longestStreakEnd = days[days.indexOf(day) - 1]?.date || tempStreakStart;
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
    totalContributions: calendar.totalContributions,
    currentStreak,
    longestStreak,
    streakStartDate: currentStreakStart || fallbackDate,
    streakEndDate: currentStreakEnd || fallbackDate,
    longestStreakStartDate: longestStreakStart || fallbackDate,
    longestStreakEndDate: longestStreakEnd || fallbackDate,
    firstContributionDate: user.createdAt,
  };
}
