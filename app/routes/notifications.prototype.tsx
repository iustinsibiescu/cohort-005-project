// PROTOTYPE (issue #7): the full Notification log page used by variants A
// and B. Variant C has no page, only the drawer.

import { usePrototypeVariant } from "~/components/prototype-switcher";
import {
  NOTIFICATION_VARIANTS,
  NotificationsPageA,
} from "~/components/notifications.prototype/variants";

export default function NotificationsPrototypePage() {
  const variant = usePrototypeVariant(NOTIFICATION_VARIANTS.map((v) => v.key));
  if (variant === "C") {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Variant C has no Notifications page: open the drawer from the sidebar footer.
      </div>
    );
  }
  return <NotificationsPageA />;
}
