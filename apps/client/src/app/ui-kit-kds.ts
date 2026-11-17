// 03b KDS entry only (/kds/): the owner kit base, the Pulse staff layer (its .pu.v-brand.kds block is the dark
// KDS token set) and the 03b layer. No pulse-02.css: the KDS shows no 02 screen. Not part of ui-kit.ts.
import '../../../../packages/ui-kit/tokens.css';
import '../../../../packages/ui-kit/components/bundle.css';
import '../../../../packages/ui-kit/components/pulse-staff.css';
import '../../../../packages/ui-kit/components/pulse-03.css';
// IR-14 (lane K): the frames' inline layout as classes, after pulse-03.css (which stays a byte copy)
import '../../../../packages/ui-kit/components/kds-03-additions.css';
