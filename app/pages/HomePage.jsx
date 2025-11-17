import React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const navigate = useNavigate();

  const tools = [
    {
      id: "uuid-generator",
      name: "UUID Generator",
      description: "Generate UUIDs v1, v4, v5, and v7",
      icon: "🔑",
      route: "/uuid-generator",
    },
    {
      id: "json-tools",
      name: "JSON Tools",
      description: "Format, validate, and manipulate JSON",
      icon: "📋",
      route: "/json-tools",
    },
    {
      id: "base64-tools",
      name: "Base64 Tools",
      description: "Encode and decode Base64",
      icon: "🔐",
      route: "/base64-tools",
    },
    {
      id: "qr-tools",
      name: "QR Tools",
      description: "Generate and scan QR codes",
      icon: "📱",
      route: "/qr-tools",
    },
    {
      id: "quick-query",
      name: "Quick Query",
      description: "Rapid data analysis with spreadsheet interface",
      icon: "📊",
      route: "/quick-query",
    },
    {
      id: "html-editor",
      name: "HTML Editor",
      description: "Edit and preview HTML",
      icon: "🌐",
      route: "/html-editor",
    },
    {
      id: "splunk-template",
      name: "Splunk Template",
      description: "Edit Splunk VTL templates",
      icon: "📝",
      route: "/splunk-template",
    },
    {
      id: "sql-in-clause",
      name: "SQL IN Clause",
      description: "Generate SQL IN clauses from lists",
      icon: "💾",
      route: "/sql-in-clause",
    },
    {
      id: "image-checker",
      name: "Image Checker",
      description: "Analyze and check images",
      icon: "🖼️",
      route: "/image-checker",
    },
    {
      id: "jenkins-runner",
      name: "Jenkins Runner",
      description: "Run Jenkins jobs",
      icon: "🚀",
      route: "/jenkins-runner",
    },
  ];

  return (
    <div className="home-container p-6">
      <div className="home-header mb-8">
        <h1 className="text-3xl font-bold mb-2">Welcome to AD Tools</h1>
        <p className="text-muted-foreground">Select a tool to get started</p>
      </div>

      <div className="tools-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <Card
            key={tool.id}
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => navigate(tool.route)}
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="text-3xl">{tool.icon}</div>
                <div className="flex-1">
                  <CardTitle className="text-lg mb-1">{tool.name}</CardTitle>
                  <CardDescription>{tool.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
