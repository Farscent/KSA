| Item                  | Proposed definition                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Identify unusually concentrated or persistent broker selling relative to a stock’s own history.                                                               |
| Observation unit      | One stock on one trading date, using the same market scope and units across brokers.                                                                          |
| Broker net flow       | `buy_value − sell_value`. Negative means the broker is a net seller.                                                                                          |
| Net-selling magnitude | `max(sell_value − buy_value, 0)` for each broker.                                                                                                             |
| `seller_hhi`          | Sum of squared broker shares of total **net-selling magnitude**, across all net-selling brokers. Higher means more concentrated.                              |
| `inst_sell_breadth`   | Number of active institutional-cohort brokers that are net sellers ÷ number of active institutional-cohort brokers. “Active” means nonzero buying or selling. |
| Persistence           | Proposed starting measure: number of days meeting the daily structural condition within the last five trading days.                                           |
| Historical baseline   | The **preceding** 60 trading days, excluding the date being scored.                                                                                           |
| Interpretation        | An unusual broker-trading pattern warrants review; it does not establish investor identity, intent, or future price direction.                                |
