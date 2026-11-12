// stub (W0.6); owned by lane O, task 26b
import type { OrderType } from '../contracts';

// 02b §8 Ordering screen (02-S05, 02-S10). #/order/<type>/<id>: dine_in → id = seating_id; takeaway / parking → a
// new order's draft id.
export interface OrderScreenProps {
  order_type: OrderType;
  id: string;
}

export const OrderScreen: (props: OrderScreenProps) => null = () => null;
