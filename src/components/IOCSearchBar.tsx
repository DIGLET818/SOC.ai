import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface IOCSearchBarProps {
  query: string;
  searchType: "ip" | "domain" | "hash";
  onQueryChange: (value: string) => void;
  onSearchTypeChange: (value: "ip" | "domain" | "hash") => void;
  onSearch: () => void;
}

export function IOCSearchBar({
  query,
  searchType,
  onQueryChange,
  onSearchTypeChange,
  onSearch,
}: IOCSearchBarProps) {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSearch();
    }
  };

  return (
    <Card className="p-6 shadow-lg">
      <div className="flex gap-3">
        <Select value={searchType} onValueChange={onSearchTypeChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ip">IP Address</SelectItem>
            <SelectItem value="domain">Domain</SelectItem>
            <SelectItem value="hash">File Hash</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder={
            searchType === "ip"
              ? "Enter IP address (e.g., 192.168.1.1)"
              : searchType === "domain"
              ? "Enter domain (e.g., example.com)"
              : "Enter file hash (MD5/SHA256)"
          }
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyPress={handleKeyPress}
          className="flex-1"
        />
        <Button onClick={onSearch} className="px-6">
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>
      </div>
    </Card>
  );
}
