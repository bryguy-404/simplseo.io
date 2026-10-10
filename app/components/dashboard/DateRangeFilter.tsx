import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays } from "lucide-react";

interface DateRangeFilterProps {
  value: string;
  onValueChange: (value: string) => void;
  isLoading?: boolean;
}

const DateRangeFilter = ({ value, onValueChange, isLoading }: DateRangeFilterProps) => {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-[180px]" disabled={isLoading}>
        <CalendarDays className="mr-2 h-4 w-4" />
        <SelectValue placeholder="Select date range" />
        {isLoading && (
          <div className="ml-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7">Last 7 days</SelectItem>
        <SelectItem value="28">Last 28 days</SelectItem>
        <SelectItem value="90">Last 3 months</SelectItem>
        <SelectItem value="all">Last 12 months</SelectItem>
      </SelectContent>
    </Select>
  );
};

export default DateRangeFilter;
