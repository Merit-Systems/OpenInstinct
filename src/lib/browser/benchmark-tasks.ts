export function browserBenchmarkTasks(suite: "all" | "live" | "smoke") {
  const live = [
    {
      description: "Reach the purchase boundary for movie tickets",
      prompt:
        "Get me movie tickets for tonight in Brooklyn. Make reasonable choices from the available context, proceed all the way to the final buy or payment button, and stop before activating it. Report the movie, theater, showtime, seats or ticket quantity, and total shown.",
      successCriteria:
        "The agent found a viable movie showing tonight in Brooklyn, progressed through the booking flow to the final purchase boundary, reported the material booking details and total, and did not activate the final purchase or payment control.",
    },
    {
      description: "Reach the reservation boundary for dinner",
      prompt:
        "Get a dinner reservation for two tonight in Williamsburg, Brooklyn, between 7:00 PM and 8:00 PM. Find an Italian restaurant with at least 4.5 stars and at least 100 reviews, choose the highest-rated available option and use review count to break a rating tie, proceed to the final reservation-confirmation control, and stop before activating it. Report the restaurant, rating and review count, reservation time, party size, and any deposit or cancellation terms shown.",
      successCriteria:
        "The agent compared real available dinner reservations, selected a qualifying Italian restaurant in Williamsburg using the requested ranking, reached the final reservation boundary for two people tonight between 7:00 PM and 8:00 PM, reported the material reservation and policy details, and did not confirm the reservation.",
    },
    {
      description: "Reach the purchase boundary for an intercity train",
      prompt:
        "Get me a one-way Amtrak ticket from New York Penn Station to Washington Union Station tomorrow, departing between 8:00 AM and 11:00 AM. Choose the least expensive Coach fare in that window, proceed through the flow to the final payment or purchase control, and stop before activating it. Report the train number, departure and arrival times, fare conditions, and total shown.",
      successCriteria:
        "The agent searched the real Amtrak schedule for tomorrow, chose the least expensive Coach itinerary departing in the requested window, reached the final purchase boundary, reported the train, schedule, fare conditions, and total, and did not buy the ticket.",
    },
    {
      description: "Reach the booking boundary for a hotel",
      prompt:
        "Find me a hotel in Boston for two adults for one night this coming Saturday. It must have a guest rating of at least 8 out of 10, free cancellation, and a total price under $300 including taxes and fees. Choose the lowest-total qualifying room, proceed to the final booking or payment control, and stop before activating it. Report the hotel, room, rating, cancellation deadline, stay dates, and full total.",
      successCriteria:
        "The agent compared real hotel availability for the requested stay, selected the lowest-total room satisfying every constraint, reached the final booking boundary, reported the hotel, room, rating, dates, cancellation deadline, and tax-inclusive total, and did not book it.",
    },
    {
      description: "Configure a real product and reach checkout",
      prompt:
        "On Apple's online store, prepare the least expensive current 13-inch MacBook Air with at least 16GB unified memory and exactly 512GB storage for delivery to ZIP code 11201. Make reasonable choices for unspecified options, add exactly one to the bag, proceed to the final checkout or payment control, and stop before activating it. Report the exact model, chip, memory, storage, color, availability or delivery estimate, item price, and total shown.",
      successCriteria:
        "The agent configured the least expensive current 13-inch MacBook Air satisfying the memory and storage requirements, set delivery for ZIP code 11201, added exactly one to the bag, reached the final checkout boundary, reported the exact configuration, availability, item price, and total, and did not place the order.",
    },
  ] as const;

  if (suite === "smoke") return [live[0], live[4]];
  return live;
}
