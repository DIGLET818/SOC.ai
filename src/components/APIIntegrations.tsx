import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function APIIntegrations() {
  const handleSave = () => {
    toast.success("API configuration saved successfully");
  };

  return (
    <div className="grid gap-6">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Threat Intelligence APIs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="virustotal">VirusTotal API Key</Label>
            <Input id="virustotal" type="password" placeholder="Enter VirusTotal API key" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="abuseipdb">AbuseIPDB API Key</Label>
            <Input id="abuseipdb" type="password" placeholder="Enter AbuseIPDB API key" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="greynoise">GreyNoise API Key</Label>
            <Input id="greynoise" type="password" placeholder="Enter GreyNoise API key" />
          </div>
          <Button onClick={handleSave}>Save Configuration</Button>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Email Ingestion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="imap-server">IMAP Server</Label>
            <Input id="imap-server" placeholder="imap.gmail.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="imap-port">Port</Label>
            <Input id="imap-port" placeholder="993" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input id="email" type="email" placeholder="soc@company.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-password">Password</Label>
            <Input id="email-password" type="password" placeholder="Enter password" />
          </div>
          <Button onClick={handleSave}>Save Configuration</Button>
        </CardContent>
      </Card>
    </div>
  );
}
