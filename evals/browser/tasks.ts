export const browserBenchmarkFixtureContext =
  "This is a controlled browser benchmark. Any identity, birth date, email, phone, street address, and payment-card values available to the browser agent are synthetic test fixtures rather than real-user facts. Do not penalize a result because those fixture values look artificial.";

export function browserBenchmarkTasks(suite: "all" | "live" | "smoke") {
  const live = [
    {
      description: "Reach the purchase boundary for movie tickets",
      prompt:
        "On Alamo Drafthouse's official website, get me movie tickets for tonight at its Downtown Brooklyn theater. Make reasonable choices from the available context, proceed all the way to the final buy or payment button, and stop before activating it. Report the movie, theater, showtime, seats or ticket quantity, and total shown.",
      successCriteria:
        "The agent used Alamo Drafthouse's official website, found a viable movie showing tonight at its Downtown Brooklyn theater, progressed through the booking flow to the final purchase boundary, reported the material booking details and total, and did not activate the final purchase or payment control.",
    },
    {
      description: "Reach the reservation boundary for dinner",
      prompt:
        "On OpenTable, get a dinner reservation for two tonight in Williamsburg, Brooklyn, between 7:00 PM and 8:00 PM. Find an Italian restaurant with at least 4.5 stars and at least 100 reviews, choose the highest-rated available option and use review count to break a rating tie, proceed to the final reservation-confirmation control, and stop before activating it. Report the restaurant, rating and review count, reservation time, party size, and any deposit or cancellation terms shown.",
      successCriteria:
        "The agent used OpenTable to compare real available dinner reservations, selected a qualifying Italian restaurant in Williamsburg using the requested ranking, reached the final reservation boundary for two people tonight between 7:00 PM and 8:00 PM, reported the material reservation and policy details, and did not confirm the reservation.",
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
        "On Booking.com, find me a hotel in Boston for two adults for one night this coming Saturday. It must have a guest rating of at least 8 out of 10, free cancellation, and a total price under $300 including taxes and fees. Choose the lowest-total qualifying room, proceed to the final booking or payment control, and stop before activating it. Report the hotel, room, rating, cancellation deadline, stay dates, and full total.",
      successCriteria:
        "The agent used Booking.com to compare real hotel availability for the requested stay, selected the lowest-total room satisfying every constraint, reached the final booking boundary, reported the hotel, room, rating, dates, cancellation deadline, and tax-inclusive total, and did not book it.",
    },
    {
      description: "Configure a real product and reach checkout",
      prompt:
        "On Apple's online store, prepare the least expensive current 13-inch MacBook Air with at least 16GB unified memory and exactly 512GB storage for delivery to ZIP code 11201. Make reasonable choices for unspecified options, add exactly one to the bag, proceed to the final checkout or payment control, and stop before activating it. Report the exact model, chip, memory, storage, color, availability or delivery estimate, item price, and total shown.",
      successCriteria:
        "The agent configured the least expensive current 13-inch MacBook Air satisfying the memory and storage requirements, set delivery for ZIP code 11201, added exactly one to the bag, reached the final checkout boundary, reported the exact configuration, availability, item price, and total, and did not place the order.",
      judgeContext:
        "Apple may suggest ZIP code 11222 as an address correction. The suggestion alone is not evidence that the destination requirement failed when the worker explicitly verifies that the final checkout state retained the requested ZIP code 11201. Fail if the worker reports that the final state used a different ZIP code or does not verify that it retained 11201.",
    },
    {
      description: "Select a next-month date on Peek",
      prompt:
        "On https://www.peek.com/new-york-city/r043/bagel-tour-explore-nycs-iconic-bagel-shops/a0k6qwp, keep the quantity at exactly one Adult, open the date picker, navigate to the next calendar month, and select the earliest enabled tour date in that month. Stop after the page shows the available start times for the selected date. Report the selected date, quantity, available start times, and displayed per-person price. Do not continue to checkout or make a booking.",
      successCriteria:
        "The agent used the real Peek bagel-tour booking widget, kept the quantity at one Adult, opened the date picker, navigated to the next calendar month, selected the earliest enabled tour date there, verified and reported the available start times and displayed per-person price, and did not continue to checkout or book the tour.",
    },
    {
      description: "Reach checkout for a Yankees game",
      prompt:
        "Find one ticket for a New York Yankees game this coming weekend. Use the Yankees' official schedule to identify a game, then use an official or authorized ticketing flow. Choose the least expensive selectable standard adult ticket after fees, proceed to the final purchase or payment control, and stop before activating it. Report the opponent, date and time, stadium, section, row and seat when assigned, ticket price, fees, and total shown.",
      successCriteria:
        "The agent identified a real Yankees game this coming weekend from the official schedule, selected exactly one standard adult ticket through an official or authorized seller, chose the least expensive selectable option based on the displayed total, reached the final purchase boundary, reported the game and seat details plus the ticket price, fees, and total, and did not buy the ticket.",
    },
    {
      description: "Reach checkout for an Elsewhere concert",
      prompt:
        "On Elsewhere's official website, find a concert at Elsewhere in Brooklyn this coming weekend with tickets available. Choose the available concert with the lowest ticket price, using the earlier start time to break a price tie. Select exactly one standard general-admission adult ticket, proceed through the official ticketing flow to the final purchase or payment control, and stop before activating it. Report the artist or event, date and time, room, ticket type, ticket price, fees, and total shown.",
      successCriteria:
        "The agent used Elsewhere's official calendar to compare real concerts this coming weekend, selected the lowest-priced available concert using the requested tie-break, selected exactly one standard general-admission adult ticket, reached the final purchase boundary in the official ticketing flow, reported the material event and price details, and did not buy the ticket.",
    },
    {
      description: "Choose a facial moisturizer and reach checkout",
      prompt:
        "On Target's website, get me a moisturizer for my face. Choose a fragrance-free facial moisturizer suitable for normal or sensitive skin that costs no more than $40, has at least a 4.5-star rating, and has at least 500 reviews. Pick the highest-rated qualifying product, using review count and then lower price as tie-breakers. Add exactly one to the cart, proceed to the final purchase or payment control, and stop before activating it. Report the product and size, why it qualifies, rating and review count, fulfillment method, item price, and final total shown.",
      successCriteria:
        "The agent used Target to compare real facial moisturizers, selected a fragrance-free product suitable for normal or sensitive skin within the price limit and meeting the rating and review requirements, followed the requested ranking, added exactly one, reached the final checkout boundary, reported the product, qualification evidence, fulfillment, price, and total, and did not place the order.",
    },
    {
      description: "Reach checkout for a nonstop flight",
      prompt:
        "On Google Flights, find a one-way nonstop Economy flight for one adult from any New York City airport to any Chicago airport next Friday, departing between 8:00 AM and noon local time. Choose the least expensive qualifying itinerary, follow the booking option to the airline or authorized seller, proceed to the final purchase or payment control, and stop before activating it. Report the airline, flight number, airports, departure and arrival times, fare or cabin, baggage terms, and total shown.",
      successCriteria:
        "The agent used Google Flights to compare real itineraries for next Friday, selected the least expensive one-way nonstop Economy flight for one adult from New York City to Chicago departing in the requested window, followed a booking option to the airline or authorized seller, reached the final purchase boundary, reported the itinerary, fare, baggage terms, and total, and did not buy the flight.",
    },
    {
      description: "Reach checkout for a weekend car rental",
      prompt:
        "On Expedia, find a compact rental car at JFK Airport for this coming weekend, picking up Friday at noon and returning Sunday at noon. Choose the lowest-total option with unlimited mileage, proceed through the flow to the final reservation or payment control, and stop before activating it. Report the rental company, car class, pickup and return times, mileage and cancellation terms, pay-now or pay-later status, and the full total including taxes and fees.",
      successCriteria:
        "The agent used Expedia to compare real compact rental cars at JFK for the requested weekend times, selected the lowest-total option with unlimited mileage, reached the final reservation or payment boundary, reported the company, car class, times, mileage and cancellation terms, payment timing, and tax-inclusive total, and did not reserve or pay for the car.",
    },
    {
      description: "Reach checkout for a Home Depot purchase",
      prompt:
        "On Home Depot's official website, get me one 25-foot grounded indoor/outdoor extension cord rated for at least 15 amps. It must cost no more than $40, have at least a 4.5-star rating, and have at least 100 reviews. Choose the lowest-priced qualifying product, using review count to break a price tie. Set fulfillment to delivery to ZIP code 11201, add exactly one to the cart, continue as a guest, fill the available synthetic checkout details, and proceed until the final Place Order or purchase control is ready. Stop before activating that final control. Report the brand and model, length and electrical rating, rating and review count, fulfillment and delivery estimate, item price, shipping, tax, and final total shown.",
      successCriteria:
        "The agent used Home Depot's official website to compare real extension cords, selected the lowest-priced product satisfying the length, grounding, amperage, price, rating, and review requirements using the requested tie-break, set delivery to ZIP code 11201, added exactly one, continued through guest checkout with the synthetic fixture details until the final order control was ready, reported the material product, fulfillment, delivery, and itemized price details, and did not place the order.",
    },
  ] as const;

  if (suite === "smoke") return [live[0], live[4]];
  return live;
}
